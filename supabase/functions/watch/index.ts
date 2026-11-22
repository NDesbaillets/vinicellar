// Vinicellar · surveillance des prix des vins des Envies et des Vins passés.
//
// Deux temps :
// 1. Recherche (IA, rare) : pour un vin surveillé, Claude cherche sa page produit chez les sites choisis par
//    l'utilisateur (et chez le producteur) et relève le prix par bouteille. Plafond de dépense par utilisateur et par mois.
// 2. Relevé (sans IA, chaque nuit) : la fonction relit ces pages, lit le prix (extract.ts), garde l'historique et crée
//    les alertes : prix cible atteint, baisse par rapport au prix habituel, prix barré, retour en stock.
// Les alertes partent en notification (iPhone, Web Push) et/ou par e-mail, selon les réglages du Compte.
//
// Appels :
// - planificateur (pg_cron, toutes les heures) : en-tête x-watch-key = clé « watch_cron_key » du coffre (Vault) ;
// - utilisateur connecté : { action: "discover" | "check", watch_id }, { action: "test" } ou { action: "vapid" }.
// Clés : lues dans le coffre par public.watch_config() (réservée à la clé de service). Les clés de notification
// (VAPID) sont créées ici au premier besoin et rangées dans le coffre ; elles ne quittent jamais le serveur, sauf la publique.
// Secrets de fonction : ANTHROPIC_API_KEY. Optionnels : WATCH_MONTHLY_CHF (défaut 2), RESEND_API_KEY + WATCH_EMAIL_FROM (e-mails).
import Anthropic from "npm:@anthropic-ai/sdk@0.121.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";
import { extract } from "./extract.ts";

const ALLOWED_ORIGINS = ["https://vinicellar.ch", "https://www.vinicellar.ch", "http://localhost:8000"];
const MODEL = "claude-sonnet-5-5";
const MONTHLY_CHF = Number(Deno.env.get("WATCH_MONTHLY_CHF") ?? "2");
const USD_CHF = 0.9;                       // conversion prudente pour le plafond
const DISCOVER_ESTIMATE_CHF = 0.12;        // dépense maximale attendue d'une recherche, vérifiée avant de la lancer
const UA = "Mozilla/5.0 (compatible; VinicellarPriceWatch/1.0; +https://vinicellar.ch)";

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Db = any;
type Watch = { id: string; user_id: string; item_id: string; target_price: number | null; currency: string; discovered_at: string | null };
type Item = { id: string; name: string; producer: string | null; vintage: number | null; appellation: string | null; region: string | null; country: string | null; volume_cl: number | null; producer_url: string | null; market_price: number | null; market_currency: string | null; category: string };
type Offer = { id: string; watch_id: string; user_id: string; site_domain: string; url: string; title: string | null; vintage: number | null; volume_cl: number | null; price: number | null; regular_price: number | null; currency: string | null; in_stock: boolean | null; status: string; fails: number };

const monthKey = () => new Date().toISOString().slice(0, 7) + "-01";
const round2 = (n: number) => Math.round(n * 100) / 100;
const hostOf = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : null; } catch { return null; } };

// ------------------------------------------------------------------ clés (coffre)
type Config = { cron_key: string | null; vapid_public: string | null; vapid_private: string | null };
let config: Config | null = null;
async function getConfig(admin: Db, needVapid = false): Promise<Config> {
  if (!config) { const { data } = await admin.rpc("watch_config"); config = data ?? { cron_key: null, vapid_public: null, vapid_private: null }; }
  if (needVapid && !config!.vapid_private) {
    const k = webpush.generateVAPIDKeys();
    await admin.rpc("watch_set_vapid", { p_public: k.publicKey, p_private: k.privateKey });
    config = null;
    const { data } = await admin.rpc("watch_config");   // relu : une autre exécution a pu créer les clés en même temps
    config = data;
  }
  return config!;
}

// ------------------------------------------------------------------ dépenses
async function spent(admin: Db, userId: string) {
  const { data } = await admin.from("watch_usage").select("cost_chf").eq("user_id", userId).eq("month", monthKey()).maybeSingle();
  return Number(data?.cost_chf ?? 0);
}
async function addCost(admin: Db, userId: string, chf: number) {
  const m = monthKey();
  const { data } = await admin.from("watch_usage").select("cost_chf, calls").eq("user_id", userId).eq("month", m).maybeSingle();
  await admin.from("watch_usage").upsert({ user_id: userId, month: m, cost_chf: Math.round((Number(data?.cost_chf ?? 0) + chf) * 10000) / 10000, calls: (data?.calls ?? 0) + 1 });
}
// Tarifs Claude Sonnet 5.5 : 2 $ / 10 $ par million de jetons, lecture du cache 0,10 $ ; recherche web 0,01 $.
// deno-lint-ignore no-explicit-any
function costChf(u: any) {
  const usd = (u.input_tokens ?? 0) * 2e-6 + (u.cache_creation_input_tokens ?? 0) * 2.5e-6 + (u.cache_read_input_tokens ?? 0) * 0.1e-6
    + (u.output_tokens ?? 0) * 10e-6 + (u.server_tool_use?.web_search_requests ?? 0) * 0.01;
  return usd * USD_CHF;
}

// ------------------------------------------------------------------ recherche des pages produit (IA)
const SYSTEM = `Tu cherches où acheter une bouteille précise, pour une alerte de prix. Uniquement sur les sites autorisés par l'outil de recherche.
Pour chaque site qui vend CE vin (même producteur, même cuvée), donne la page produit exacte (pas une liste, pas une recherche) et le prix lu sur la page ou l'extrait.
- Millésime : celui demandé s'il est en vente ; sinon le millésime proposé, indiqué dans vintage.
- Prix par bouteille (unit_price) : si la page vend par carton de 6, divise. Contenance en cl (75, 70, 50, 150…).
- regular_unit_price : prix normal barré si un prix promotionnel est affiché, sinon null.
- Une seule page par site, la plus proche du vin demandé. Rien d'inventé : un site sans page trouvée n'apparaît pas.
Réponds uniquement par ce JSON : {"offers":[{"url":"https://…","title":"","vintage":int|null,"volume_cl":int|null,"unit_price":num,"regular_unit_price":num|null,"currency":"CHF|EUR","in_stock":bool|null}]}`;

async function discover(admin: Db, apiKey: string, w: Watch, it: Item, domains: string[]) {
  const producerHost = hostOf(it.producer_url);
  const allowed = [...new Set([...domains, ...(producerHost ? [producerHost] : [])])].slice(0, 60);
  if (!allowed.length) return { offers: 0, note: "Aucun site actif dans le Compte." };
  const wine = [it.producer, it.name, it.vintage, it.appellation || it.region, it.country, it.volume_cl ? `${it.volume_cl} cl` : null].filter(Boolean).join(" · ");
  const client = new Anthropic({ apiKey });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: `Vin : ${wine}${it.market_price ? `\nPrix indicatif : ${it.market_price} ${it.market_currency || "CHF"}` : ""}` }];
  let cost = 0, final: Anthropic.Beta.BetaMessage | null = null;
  for (let i = 0; i < 3; i++) {
    final = await client.beta.messages.create({
      model: MODEL, max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5, allowed_domains: allowed }],
      messages,
    });
    cost += costChf(final.usage);
    if (final.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: final.content });
  }
  await addCost(admin, w.user_id, cost);
  await admin.from("ai_calls").insert({ user_id: w.user_id, kind: "watch", ok: !!final && final.stop_reason !== "refusal" });
  if (!final || final.stop_reason === "refusal") return { offers: 0, note: "Recherche impossible pour ce vin." };
  const text = final.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  let raw: { offers?: unknown } = {};
  try { raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* réponse illisible */ }
  const list = Array.isArray(raw.offers) ? raw.offers as Record<string, unknown>[] : [];
  const now = new Date().toISOString();
  let n = 0;
  const seenHosts = new Set<string>();
  for (const o of list.slice(0, 12)) {
    const url = typeof o.url === "string" ? o.url.trim() : "";
    const host = hostOf(url);
    const unit = Number(o.unit_price);
    if (!url.startsWith("https://") || !host || !allowed.some((d) => host === d || host.endsWith("." + d)) || !(unit > 0 && unit < 100000) || seenHosts.has(host)) continue;
    seenHosts.add(host);
    const reg = Number(o.regular_unit_price);
    const row = {
      watch_id: w.id, user_id: w.user_id, site_domain: allowed.find((d) => host === d || host.endsWith("." + d))!, url: url.slice(0, 1000),
      title: typeof o.title === "string" ? o.title.slice(0, 200) : null,
      vintage: Number.isInteger(o.vintage) ? o.vintage as number : null,
      volume_cl: Number.isInteger(o.volume_cl) && (o.volume_cl as number) >= 5 && (o.volume_cl as number) <= 3000 ? o.volume_cl as number : null,
      price: round2(unit), regular_price: reg > unit ? round2(reg) : null,
      currency: o.currency === "EUR" ? "EUR" : "CHF", in_stock: typeof o.in_stock === "boolean" ? o.in_stock : null,
      status: "ok", fails: 0, checked_at: now,
    };
    const { data: before } = await admin.from("watch_offers").select("*").eq("watch_id", w.id).eq("url", row.url).maybeSingle();
    const { data: saved } = await admin.from("watch_offers").upsert(row, { onConflict: "watch_id,url" }).select("*").single();
    if (!saved) continue;
    n++;
    await admin.from("watch_prices").insert({ offer_id: saved.id, price: row.price, regular_price: row.regular_price, in_stock: row.in_stock });
    await evaluate(admin, w, saved, before);
  }
  await admin.from("watches").update({ discovered_at: now, discover_note: n ? null : "Aucune page trouvée chez les sites choisis." }).eq("id", w.id);
  return { offers: n, note: n ? null : "Aucune page trouvée chez les sites choisis." };
}

// ------------------------------------------------------------------ relevé d'une page (sans IA)
async function check(admin: Db, o: Offer, w: Watch) {
  const now = new Date().toISOString();
  let html = "", status = 0;
  try {
    const res = await fetch(o.url, { headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "fr-CH,fr;q=0.9,de;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    status = res.status;
    if (res.ok) html = (await res.text()).slice(0, 3_000_000);
  } catch { status = 0; }
  if (status === 404 || status === 410) {
    await admin.from("watch_offers").update({ status: "gone", checked_at: now }).eq("id", o.id);
    return "gone";
  }
  const r = html ? extract(html, o.price) : null;
  if (!r) {
    const fails = o.fails + 1;
    await admin.from("watch_offers").update({ fails, status: fails >= 3 ? "error" : o.status, checked_at: now }).eq("id", o.id);
    return "error";
  }
  const patch = { price: r.unit, regular_price: r.regular, currency: r.currency ?? o.currency, in_stock: r.inStock ?? o.in_stock, status: "ok", fails: 0, checked_at: now };
  const { data: saved } = await admin.from("watch_offers").update(patch).eq("id", o.id).select("*").single();
  await admin.from("watch_prices").insert({ offer_id: o.id, price: r.unit, regular_price: r.regular, in_stock: patch.in_stock });
  if (saved) await evaluate(admin, w, saved, o);
  return "ok";
}

// ------------------------------------------------------------------ alertes
async function evaluate(admin: Db, w: Watch, o: Offer, prev: Offer | null) {
  if (!o.price) return;
  const { data: prefs } = await admin.from("watch_prefs").select("drop_pct").eq("user_id", w.user_id).maybeSingle();
  const dropPct = prefs?.drop_pct ?? 15;
  // Prix par bouteille : tel quel pour 50 à 100 cl (70 et 75 cl), ramené à 75 cl pour un magnum ou une demi-bouteille.
  const perBottle = (p: number | null, vol: number | null) => p == null ? null : !vol || (vol >= 50 && vol <= 100) ? p : p * 75 / vol;
  const now = perBottle(o.price, o.volume_cl)!, before = prev ? perBottle(prev.price, prev.volume_cl ?? o.volume_cl) : null;
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data: recent } = await admin.from("watch_alerts").select("kind").eq("offer_id", o.id).gte("created_at", since);
  const done = new Set((recent ?? []).map((a: { kind: string }) => a.kind));
  const kinds: string[] = [];
  const sameCurrency = (o.currency || "CHF") === (w.currency || "CHF");
  if (w.target_price && sameCurrency && now <= w.target_price && !(before != null && before <= w.target_price)) kinds.push("target");
  if (o.regular_price && o.regular_price >= o.price * 1.05 && !(prev?.regular_price && prev.price && prev.regular_price >= prev.price * 1.05)) kinds.push("promo");
  if (prev?.in_stock === false && o.in_stock === true) kinds.push("back");
  // Prix habituel : médiane des 60 derniers jours, au moins 3 relevés.
  const { data: hist } = await admin.from("watch_prices").select("price").eq("offer_id", o.id).gte("seen_at", new Date(Date.now() - 60 * 864e5).toISOString()).order("seen_at", { ascending: false }).limit(90);
  const past = (hist ?? []).slice(1).map((h: { price: number }) => Number(h.price)).sort((a: number, b: number) => a - b);
  if (past.length >= 3) {
    const med = past[Math.floor(past.length / 2)];
    if (o.price <= med * (1 - dropPct / 100)) kinds.push("drop");
  }
  for (const kind of kinds.filter((k) => !done.has(k))) {
    await admin.from("watch_alerts").insert({ user_id: w.user_id, watch_id: w.id, offer_id: o.id, kind, price: o.price, regular_price: o.regular_price, currency: o.currency, url: o.url, site_domain: o.site_domain });
  }
}

// ------------------------------------------------------------------ notifications
const KIND = { target: "prix cible atteint", drop: "baisse de prix", promo: "en promotion", back: "de nouveau disponible" } as Record<string, string>;
const money = (n: number | null, c: string | null) => n == null ? "" : `${c || "CHF"} ${Number(n).toFixed(2)}`;

async function notify(admin: Db, onlyUser?: string) {
  let q = admin.from("watch_alerts").select("id, user_id, kind, price, regular_price, currency, url, site_domain, watches(items(name, vintage, producer))").is("notified_at", null).order("created_at").limit(200);
  if (onlyUser) q = q.eq("user_id", onlyUser);
  const { data: alerts } = await q;
  const byUser = new Map<string, Record<string, unknown>[]>();
  for (const a of alerts ?? []) { if (!byUser.has(a.user_id)) byUser.set(a.user_id, []); byUser.get(a.user_id)!.push(a); }
  for (const [userId, list] of byUser) {
    const lines = list.map((a) => {
      // deno-lint-ignore no-explicit-any
      const it = (a.watches as any)?.items ?? {};
      return `${it.name ?? "Vin"}${it.vintage ? " " + it.vintage : ""} : ${KIND[a.kind as string]}, ${money(a.price as number, a.currency as string)}${a.regular_price ? ` au lieu de ${money(a.regular_price as number, a.currency as string)}` : ""} chez ${a.site_domain}`;
    });
    const title = list.length > 1 ? `Prix : ${list.length} alertes sur vos vins` : "Prix : un vin de vos envies";
    await deliver(admin, userId, title, lines, list as { url?: string }[]);
    await admin.from("watch_alerts").update({ notified_at: new Date().toISOString() }).in("id", list.map((a) => a.id));
  }
  return byUser.size;
}

async function deliver(admin: Db, userId: string, title: string, lines: string[], alerts: { url?: string }[] = []) {
  const { data: prefs } = await admin.from("watch_prefs").select("notify_push, notify_email").eq("user_id", userId).maybeSingle();
  const out = { push: 0, email: false };
  const cfg = prefs?.notify_push ? await getConfig(admin, true) : null;
  const pub = cfg?.vapid_public, priv = cfg?.vapid_private;
  if (prefs?.notify_push && pub && priv) {
    webpush.setVapidDetails("https://vinicellar.ch", pub, priv);
    const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
    const payload = JSON.stringify({ title, body: lines.slice(0, 3).join("\n") + (lines.length > 3 ? `\n+ ${lines.length - 3} autre(s)` : ""), url: "/app/envies.html#alertes", tag: "vinicellar-prix" });
    for (const s of subs ?? []) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); out.push++; }
      catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id); else console.warn("push", code); }
    }
  }
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("WATCH_EMAIL_FROM");
  if (prefs?.notify_email && key && from) {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const to = u?.user?.email;
    if (to) {
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
      const html = `<div style="font-family:Inter,Arial,sans-serif;color:#262C25;max-width:560px"><h2 style="color:#713D47;font-weight:500">${esc(title)}</h2><ul>${lines.map((l, i) => `<li style="margin:0 0 8px">${esc(l)}${alerts[i]?.url ? ` · <a href="${esc(alerts[i].url!)}">voir la page</a>` : ""}</li>`).join("")}</ul><p><a href="https://vinicellar.ch/app/envies.html#alertes" style="color:#713D47">Ouvrir mes envies</a></p><p style="color:#66705F;font-size:12px">Alertes de prix Vinicellar. Réglages : Compte › Alertes de prix.</p></div>`;
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject: title, html, text: lines.join("\n") }) });
      out.email = res.ok;
      if (!res.ok) console.warn("email", res.status, await res.text());
    }
  }
  return out;
}

// ------------------------------------------------------------------ tâches
// deno-lint-ignore no-explicit-any
async function loadWatch(admin: Db, id: string): Promise<{ w: Watch; it: Item } | null> {
  const { data } = await admin.from("watches").select("*, items(id, name, producer, vintage, appellation, region, country, volume_cl, producer_url, market_price, market_currency, category)").eq("id", id).single();
  return data ? { w: data, it: data.items } : null;
}
async function sitesOf(admin: Db, userId: string) {
  const { data } = await admin.from("watch_sites").select("domain").eq("user_id", userId).eq("enabled", true);
  return (data ?? []).map((s: { domain: string }) => s.domain);
}
async function canSpend(admin: Db, userId: string) { return (await spent(admin, userId)) + DISCOVER_ESTIMATE_CHF <= MONTHLY_CHF; }

async function cron(admin: Db, apiKey: string) {
  const started = Date.now(), report = { checked: 0, discovered: 0, notified: 0 };
  // 1. Relevés dus (plus de 20 h), 6 en parallèle, dans la limite de temps de la fonction.
  const due = new Date(Date.now() - 20 * 3600e3).toISOString();
  const { data: offers } = await admin.from("watch_offers").select("*, watches!inner(id, user_id, item_id, target_price, currency, active, discovered_at)")
    .in("status", ["new", "ok", "error"]).eq("watches.active", true).or(`checked_at.is.null,checked_at.lt.${due}`).order("checked_at", { ascending: true, nullsFirst: true }).limit(60);
  const queue = [...(offers ?? [])];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length && Date.now() - started < 90_000) {
      const o = queue.shift();
      try { await check(admin, o, o.watches); report.checked++; } catch (e) { console.warn("check", o.url, e); }
    }
  }));
  // 2. Recherches en attente (nouveaux vins), puis rafraîchissement mensuel, dans le plafond de chaque utilisateur.
  const month = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: todo } = await admin.from("watches").select("id, user_id").eq("active", true).or(`discovered_at.is.null,discovered_at.lt.${month}`).order("discovered_at", { ascending: true, nullsFirst: true }).limit(6);
  for (const t of todo ?? []) {
    if (report.discovered >= 3 || Date.now() - started > 100_000) break;
    if (!(await canSpend(admin, t.user_id))) continue;
    const x = await loadWatch(admin, t.id);
    if (!x) continue;
    try { await discover(admin, apiKey, x.w, x.it, await sitesOf(admin, t.user_id)); report.discovered++; } catch (e) { console.warn("discover", t.id, e); }
  }
  // 3. Notifications des nouvelles alertes.
  report.notified = await notify(admin);
  return report;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Planificateur
  const key = req.headers.get("x-watch-key");
  if (key && key === (await getConfig(admin)).cron_key) {
    if (!apiKey) return json(req, { error: "not_configured" }, 503);
    return json(req, await cron(admin, apiKey));
  }

  // Utilisateur connecté
  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (!user) return json(req, { error: "auth" }, 401);
  let body: { action?: string; watch_id?: string };
  try { body = await req.json(); } catch { return json(req, { error: "bad_request" }, 400); }

  if (body.action === "vapid") return json(req, { publicKey: (await getConfig(admin, true)).vapid_public });
  if (body.action === "test") {
    const out = await deliver(admin, user.id, "Vinicellar · test des alertes", ["Les alertes de prix arriveront ainsi."]);
    return json(req, out);
  }
  if (!body.watch_id) return json(req, { error: "bad_request" }, 400);
  // Le vin surveillé doit appartenir à l'utilisateur (lecture avec ses droits).
  const { data: mine } = await sb.from("watches").select("id").eq("id", body.watch_id).maybeSingle();
  if (!mine) return json(req, { error: "not_found" }, 404);
  const x = await loadWatch(admin, body.watch_id);
  if (!x) return json(req, { error: "not_found" }, 404);

  if (body.action === "discover") {
    if (!apiKey) return json(req, { error: "not_configured", message: "Clé ANTHROPIC_API_KEY absente." }, 503);
    if (!(await canSpend(admin, user.id))) return json(req, { error: "budget", message: `Plafond de ${MONTHLY_CHF} CHF atteint ce mois-ci. Les relevés de prix continuent ; les nouvelles recherches reprendront le mois prochain.` }, 429);
    try {
      const r = await discover(admin, apiKey, x.w, x.it, await sitesOf(admin, user.id));
      await notify(admin, user.id);
      return json(req, { ...r, spent: await spent(admin, user.id), cap: MONTHLY_CHF });
    } catch (e) {
      console.error("discover", e);
      return json(req, { error: "ai", message: "La recherche ne répond pas. Réessayez dans un instant." }, 502);
    }
  }
  if (body.action === "check") {
    const { data: offers } = await admin.from("watch_offers").select("*").eq("watch_id", x.w.id).in("status", ["new", "ok", "error"]);
    const res: string[] = [];
    for (const o of offers ?? []) res.push(await check(admin, o, x.w));
    await notify(admin, user.id);
    return json(req, { checked: res.length, ok: res.filter((r) => r === "ok").length });
  }
  return json(req, { error: "bad_request" }, 400);
});
