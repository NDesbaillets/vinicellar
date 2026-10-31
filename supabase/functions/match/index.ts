// Vinicellar · reconnaît une bouteille photographiée parmi celles en stock (pour la sortir de la cave).
// Pas de recherche web : lecture de l'étiquette et comparaison avec la liste, donc rapide et peu coûteux.
// Secret requis : ANTHROPIC_API_KEY. Optionnel : AI_MATCH_DAILY_LIMIT (défaut 100 par utilisateur et par 24 h).

import Anthropic from "npm:@anthropic-ai/sdk@0.121.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = ["https://vinicellar.ch", "https://www.vinicellar.ch", "http://localhost:8000"];
const MODEL = "claude-sonnet-5-5";
const DAILY_LIMIT = Number(Deno.env.get("AI_MATCH_DAILY_LIMIT") ?? "100");

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

const SYSTEM = `Tu aides à sortir une bouteille d'une cave. On te donne la photo d'une bouteille (souvent prise vite, de biais, dans la pénombre) et la liste numérotée des bouteilles en stock.
Lis l'étiquette (producteur, cuvée, millésime, appellation, type) et trouve la ligne correspondante.
Le millésime départage deux lignes de la même cuvée ; s'il est illisible, choisis la plus probable et mets les autres dans alternatives.
Si aucune ligne ne correspond, item = null.
Réponds uniquement avec ce JSON : {"item": numéro de ligne ou null, "confidence": 0 à 1, "alternatives": [numéros, 3 au plus], "read": {"producer": string|null, "name": string|null, "vintage": number|null}}`;

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
    .eq("user_id", user.id).eq("kind", "match").gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return json(req, { error: "quota", message: `Limite de ${DAILY_LIMIT} reconnaissances par 24 h atteinte.` }, 429);

  let body: { image?: string; media_type?: string; location_id?: string | null };
  try { body = await req.json(); } catch { return json(req, { error: "bad_request" }, 400); }
  if (typeof body.image !== "string" || body.image.length < 100) return json(req, { error: "bad_request", message: "Photo requise." }, 400);
  if (body.image.length > 7_000_000) return json(req, { error: "too_large" }, 413);

  // Bouteilles en stock visibles par l'utilisateur (règles RLS : les siennes et celles partagées).
  let q = sb.from("stock").select("item_id, location_id, quantity, items(id, name, producer, vintage, category, style, appellation, region)").gt("quantity", 0);
  if (body.location_id) q = q.eq("location_id", body.location_id);
  const { data: rows, error } = await q.limit(1000);
  if (error) return json(req, { error: "db" }, 500);
  type Item = { id: string; name: string; producer: string | null; vintage: number | null; category: string; style: string | null; appellation: string | null; region: string | null };
  const seen = new Map<string, Item>();
  for (const r of rows ?? []) { const it = (r as unknown as { items: Item }).items; if (it && !seen.has(it.id)) seen.set(it.id, it); }
  const list = [...seen.values()];
  if (!list.length) return json(req, { item_id: null, alternatives: [], read: null, message: "Aucune bouteille en stock ici." });

  const lines = list.map((it, i) => `${i + 1}. ${[it.producer, it.name, it.vintage, it.appellation || it.region, it.category === "wine" ? it.style : it.category].filter(Boolean).join(" | ")}`).join("\n");
  const media = (["image/jpeg", "image/png", "image/webp"].includes(body.media_type ?? "") ? body.media_type : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";

  const { data: callRow } = await admin.from("ai_calls").insert({ user_id: user.id, kind: "match" }).select("id").single();
  const client = new Anthropic({ apiKey });
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: media, data: body.image } },
        { type: "text", text: `Bouteilles en stock :\n${lines}` },
      ] }],
    });
  } catch (e) {
    console.error("anthropic error", e);
    await admin.from("ai_calls").update({ ok: false }).eq("id", callRow?.id);
    return json(req, { error: "ai", message: "La reconnaissance ne répond pas. Choisissez dans la liste." }, 502);
  }
  if (msg.stop_reason === "refusal") return json(req, { error: "ai", message: "Reconnaissance impossible. Choisissez dans la liste." }, 422);

  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  let raw: { item?: unknown; confidence?: unknown; alternatives?: unknown; read?: { producer?: unknown; name?: unknown; vintage?: unknown } } = {};
  try { raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* réponse illisible */ }
  const pick = (n: unknown) => { const i = Number(n); return Number.isInteger(i) && i >= 1 && i <= list.length ? list[i - 1].id : null; };
  const item_id = pick(raw.item);
  const alternatives = (Array.isArray(raw.alternatives) ? raw.alternatives : []).map(pick).filter((x): x is string => !!x && x !== item_id).slice(0, 3);
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
  const conf = Number(raw.confidence);
  await admin.from("ai_calls").update({ ok: true }).eq("id", callRow?.id);
  return json(req, {
    item_id,
    confidence: Number.isFinite(conf) && conf >= 0 && conf <= 1 ? conf : null,
    alternatives,
    read: raw.read ? { producer: s(raw.read.producer), name: s(raw.read.name), vintage: Number.isInteger(Number(raw.read.vintage)) ? Number(raw.read.vintage) : null } : null,
  });
});
