// Vinicellar · sommelier : à partir d'un menu, propose les bouteilles de la cave à ouvrir, en priorité celles à leur apogée.
// Pas de recherche web : raisonnement sur les fiches en stock (style, cépages, région, fenêtre de garde, accords).
// Secret requis : ANTHROPIC_API_KEY. Optionnel : AI_SOMMELIER_DAILY_LIMIT (défaut 40 par utilisateur et par 24 h).
import Anthropic from "npm:@anthropic-ai/sdk@0.121.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = ["https://vinicellar.ch", "https://www.vinicellar.ch", "http://localhost:8000"];
const MODEL = "claude-sonnet-5-5";
const DAILY_LIMIT = Number(Deno.env.get("AI_SOMMELIER_DAILY_LIMIT") ?? "40");

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

const SYSTEM = `Sommelier personnel d'un amateur exigeant. On te donne la liste numérotée des bouteilles de sa cave (statut de garde, prix, gamme de prix relative à sa cave), puis un menu. Choisis uniquement dans cette liste.
Pour chaque plat ou service du menu, propose au moins 3 vins différents si la cave le permet (4 au plus), du meilleur accord au moins bon, en couvrant si possible 2 à 3 gammes de prix (abordable, intermédiaire, belle bouteille) ; sans prix connu, varie plutôt les styles. Un plat unique = un seul service. Un même vin peut revenir pour un autre plat si c'est vraiment le meilleur accord.
Priorité de garde : « à l'apogée », puis « prête » ou « à boire vite ». « Trop jeune » seulement faute de mieux, « fenêtre dépassée » seulement par choix délibéré, en le disant.
Accord concret : structure, acidité, tanins, sucre, sauce, cuisson, gras, épices, intensité.
Français, sobre, sans superlatifs ; chaque justification en 1 à 2 phrases.
Réponds uniquement par ce JSON :
{"intro":"1 phrase sur l'approche","courses":[{"course":"nom du plat ou du service","picks":[{"n":ligne,"why":"pourquoi cet accord","serve":"température, carafage, verre"}]}],"missing":"si un plat manque de bons accords : style à acheter, sinon null"}`;

const year = new Date().getFullYear();
type Item = { id: string; name: string; producer: string | null; vintage: number | null; category: string; style: string | null; grapes: string[] | null;
  country: string | null; region: string | null; appellation: string | null; drink_from: number | null; drink_to: number | null;
  peak_from: number | null; peak_to: number | null; pairings: string[] | null; description: string | null;
  market_price: number | null; market_currency: string | null; purchase_price: number | null; purchase_currency: string | null };
// Prix d'une bouteille : valeur de marché, sinon prix d'achat.
const priceOf = (it: Item) => it.market_price ? { v: Number(it.market_price), c: it.market_currency || "CHF" } : it.purchase_price ? { v: Number(it.purchase_price), c: it.purchase_currency || "CHF" } : null;
const TIERS = ["abordable", "intermédiaire", "belle bouteille"];

function status(it: Item) {
  const { drink_from: f, drink_to: t, peak_from: pf, peak_to: pt } = it;
  if (it.category !== "wine") return "spiritueux";
  if (!f && !t) return "garde inconnue";
  if (t && year > t) return "fenêtre dépassée";
  if (t && year >= t - 1) return "à boire vite";
  if (pf && pt && year >= pf && year <= pt) return "à l'apogée";
  if (f && year < f) return "trop jeune";
  return "prête";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json(req, { error: "not_configured", message: "Clé ANTHROPIC_API_KEY absente des secrets." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (!user) return json(req, { error: "auth" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("ai_calls").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("kind", "sommelier").gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return json(req, { error: "quota", message: `Limite de ${DAILY_LIMIT} conseils par 24 h atteinte.` }, 429);

  let body: { menu?: string; location_id?: string | null };
  try { body = await req.json(); } catch { return json(req, { error: "bad_request" }, 400); }
  const menu = (body.menu ?? "").trim().slice(0, 2000);
  if (menu.length < 3) return json(req, { error: "bad_request", message: "Décrivez le menu." }, 400);

  let q = sb.from("stock").select("location_id, quantity, items(id, name, producer, vintage, category, style, grapes, country, region, appellation, drink_from, drink_to, peak_from, peak_to, pairings, description, market_price, market_currency, purchase_price, purchase_currency)").gt("quantity", 0);
  if (body.location_id) q = q.eq("location_id", body.location_id);
  const { data: rows, error } = await q.limit(1000);
  if (error) return json(req, { error: "db" }, 500);
  const seen = new Map<string, { it: Item; qty: number }>();
  for (const r of rows ?? []) {
    const it = (r as unknown as { items: Item }).items;
    if (!it) continue;
    const cur = seen.get(it.id);
    seen.set(it.id, { it, qty: (cur?.qty ?? 0) + (r as { quantity: number }).quantity });
  }
  const list = [...seen.values()].sort((a, b) => a.it.id.localeCompare(b.it.id));   // ordre stable pour le cache
  if (!list.length) return json(req, { intro: null, picks: [], missing: null, message: "Aucune bouteille en stock ici." });

  // Gamme de prix relative à la cave : tiers inférieur, milieu, tiers supérieur des prix connus.
  const prices = list.map(({ it }) => priceOf(it)?.v).filter((v): v is number => Number.isFinite(v)).sort((a, b) => a - b);
  const q1 = prices[Math.floor(prices.length / 3)], q2 = prices[Math.floor(prices.length * 2 / 3)];
  const tierOf = (it: Item) => { const p = priceOf(it); if (!p || prices.length < 3) return null; return p.v < q1 ? TIERS[0] : p.v < q2 ? TIERS[1] : TIERS[2]; };
  const lines = list.map(({ it, qty }, i) => `${i + 1}. ${[
    it.producer, it.name, it.vintage, it.category === "wine" ? it.style : it.category, (it.grapes ?? []).join(", "),
    [it.appellation, it.region, it.country].filter(Boolean).join(", "), `statut : ${status(it)}`,
    (it.pairings ?? []).length ? `accords connus : ${(it.pairings ?? []).slice(0, 4).join(" ; ")}` : null,
    priceOf(it) ? `prix : ${Math.round(priceOf(it)!.v)} ${priceOf(it)!.c}${tierOf(it) ? ` (${tierOf(it)})` : ""}` : "prix inconnu", `${qty} bt.`,
  ].filter(Boolean).join(" | ")}`).join("\n");

  const { data: callRow } = await admin.from("ai_calls").insert({ user_id: user.id, kind: "sommelier" }).select("id").single();
  const client = new Anthropic({ apiKey });
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 12000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      // Consignes + liste de la cave en préfixe mis en cache (plusieurs menus de suite), le menu à la fin.
      system: [{ type: "text", text: SYSTEM }, { type: "text", text: `Cave (année ${year}) :\n${lines}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Menu :\n${menu}` }],
    });
  } catch (e) {
    console.error("anthropic error", e);
    await admin.from("ai_calls").update({ ok: false }).eq("id", callRow?.id);
    return json(req, { error: "ai", message: "Le sommelier ne répond pas. Réessayez dans un instant." }, 502);
  }
  console.log("usage", JSON.stringify(msg.usage));
  if (msg.stop_reason === "refusal") return json(req, { error: "ai", message: "Conseil impossible pour ce menu." }, 422);

  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  let raw: { intro?: unknown; courses?: unknown; picks?: unknown; missing?: unknown } = {};
  try { raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* réponse illisible */ }
  const s = (v: unknown, n = 600) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const pick = (p: Record<string, unknown>) => {
    const i = Number(p?.n);
    if (!Number.isInteger(i) || i < 1 || i > list.length) return null;
    const it = list[i - 1].it, pr = priceOf(it);
    return { item_id: it.id, why: s(p.why), serve: s(p.serve, 200), status: status(it), tier: tierOf(it), price: pr ? Math.round(pr.v) : null, currency: pr?.c ?? null };
  };
  // Par plat : jusqu'à 4 vins différents ; ancienne forme (« picks » sans plats) acceptée.
  const rawCourses = Array.isArray(raw.courses) ? raw.courses : Array.isArray(raw.picks) ? [{ course: null, picks: raw.picks }] : [];
  const courses = rawCourses.slice(0, 6).map((c: Record<string, unknown>) => {
    const seenIds = new Set<string>();
    const picks = (Array.isArray(c?.picks) ? c.picks : []).map(pick).filter((p) => p && !seenIds.has(p.item_id) && seenIds.add(p.item_id)).slice(0, 4);
    return { course: s(c?.course, 120), picks };
  }).filter((c) => c.picks.length);
  const picks = courses.flatMap((c) => c.picks);
  await admin.from("ai_calls").update({ ok: picks.length > 0 }).eq("id", callRow?.id);
  return json(req, { intro: s(raw.intro), courses, picks, missing: s(raw.missing) });
});
