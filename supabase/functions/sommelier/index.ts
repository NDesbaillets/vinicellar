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

const SYSTEM = `Sommelier personnel d'un amateur exigeant. On te donne la liste numérotée des bouteilles de sa cave, avec leur statut de garde, puis un menu. Choisis uniquement dans cette liste.
Priorité : « à l'apogée », puis « prête » ou « à boire vite ». « Trop jeune » seulement faute de mieux, « fenêtre dépassée » seulement par choix délibéré, en le disant.
Accord concret : structure, acidité, tanins, sucre, sauce, cuisson, gras, épices, intensité. Menu en plusieurs services : un vin par service ou un vin pour l'ensemble.
Français, sobre, sans superlatifs ; chaque justification en 1 à 2 phrases.
Réponds uniquement par ce JSON, 3 propositions au plus, la meilleure d'abord :
{"intro":"1 phrase sur l'approche","picks":[{"n":ligne,"course":"service ou null","why":"pourquoi cet accord","serve":"température, carafage, verre"}],"missing":"si rien ne convient : style à acheter, sinon null"}`;

const year = new Date().getFullYear();
type Item = { id: string; name: string; producer: string | null; vintage: number | null; category: string; style: string | null; grapes: string[] | null;
  country: string | null; region: string | null; appellation: string | null; drink_from: number | null; drink_to: number | null;
  peak_from: number | null; peak_to: number | null; pairings: string[] | null; description: string | null };

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

  let q = sb.from("stock").select("location_id, quantity, items(id, name, producer, vintage, category, style, grapes, country, region, appellation, drink_from, drink_to, peak_from, peak_to, pairings, description)").gt("quantity", 0);
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

  const lines = list.map(({ it, qty }, i) => `${i + 1}. ${[
    it.producer, it.name, it.vintage, it.category === "wine" ? it.style : it.category, (it.grapes ?? []).join(", "),
    [it.appellation, it.region, it.country].filter(Boolean).join(", "), `statut : ${status(it)}`,
    (it.pairings ?? []).length ? `accords connus : ${(it.pairings ?? []).slice(0, 4).join(" ; ")}` : null, `${qty} bt.`,
  ].filter(Boolean).join(" | ")}`).join("\n");

  const { data: callRow } = await admin.from("ai_calls").insert({ user_id: user.id, kind: "sommelier" }).select("id").single();
  const client = new Anthropic({ apiKey });
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 6000,
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
  let raw: { intro?: unknown; picks?: unknown; missing?: unknown } = {};
  try { raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* réponse illisible */ }
  const s = (v: unknown, n = 600) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const picks = (Array.isArray(raw.picks) ? raw.picks : []).map((p: Record<string, unknown>) => {
    const i = Number(p?.n);
    if (!Number.isInteger(i) || i < 1 || i > list.length) return null;
    return { item_id: list[i - 1].it.id, course: s(p.course, 120), why: s(p.why), serve: s(p.serve, 200), status: status(list[i - 1].it) };
  }).filter(Boolean).slice(0, 3);
  await admin.from("ai_calls").update({ ok: picks.length > 0 }).eq("id", callRow?.id);
  return json(req, { intro: s(raw.intro), picks, missing: s(raw.missing) });
});
