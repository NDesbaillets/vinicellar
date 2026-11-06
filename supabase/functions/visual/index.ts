// Vinicellar · visuel propre d'une bouteille : l'IA repère l'étiquette et décrit la bouteille ;
// le navigateur redresse l'étiquette et compose l'image. Aucune image n'est générée ni stockée ici.
// Secret requis : ANTHROPIC_API_KEY. Optionnel : AI_VISUAL_DAILY_LIMIT (défaut 60 par utilisateur et par 24 h).

import Anthropic from "npm:@anthropic-ai/sdk@0.121.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = ["https://vinicellar.ch", "https://www.vinicellar.ch", "http://localhost:8000"];
const MODEL = "claude-sonnet-5-5";
const DAILY_LIMIT = Number(Deno.env.get("AI_VISUAL_DAILY_LIMIT") ?? "60");
const SHAPES = ["bordeaux", "burgundy", "champagne", "alsace", "spirit"];

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

const SYSTEM = `On te donne la photo d'une étiquette ou d'une bouteille (vin, champagne, spiritueux), ses dimensions en pixels et ce que l'on sait du vin.
1. Étiquette principale (face avant, la plus grande) : donne ses quatre coins en pixels de l'image, dans l'ordre haut gauche, haut droite, bas droite, bas gauche, au bord du papier, sans marge. Étiquette collée sur une bouteille courbe : les coins de la partie visible de face. Étiquette introuvable : null.
2. Forme de la bouteille : bordeaux (épaules marquées), burgundy (épaules tombantes), champagne (mousseux, verre épais), alsace (flûte haute et fine) ou spirit. Bouteille invisible : déduis-la de l'appellation, de la région et du type.
3. Couleurs hexadécimales : body = teinte apparente de la bouteille pleine (verre et liquide ensemble, souvent très sombre pour un rouge), capsule = capsule, surbouchage ou bouchon. Invisibles : l'usage le plus probable pour ce vin.
Réponds uniquement par ce JSON : {"corners":[[x,y],[x,y],[x,y],[x,y]]|null,"shape":"bordeaux|burgundy|champagne|alsace|spirit","body":"#rrggbb","capsule":"#rrggbb","confidence":0-1}`;

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
    .eq("user_id", user.id).eq("kind", "visual").gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return json(req, { error: "quota", message: `Limite de ${DAILY_LIMIT} visuels par 24 h atteinte.` }, 429);

  let body: { image?: string; width?: number; height?: number; wine?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json(req, { error: "bad_request" }, 400); }
  const w = Number(body.width), h = Number(body.height);
  if (typeof body.image !== "string" || body.image.length < 100 || !(w >= 50 && w <= 4000 && h >= 50 && h <= 4000)) return json(req, { error: "bad_request", message: "Photo requise." }, 400);
  if (body.image.length > 5_000_000) return json(req, { error: "too_large" }, 413);
  const s = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, 120) : "");
  const wine = body.wine ?? {};
  const about = ["category", "style", "name", "producer", "appellation", "region", "country"].map((k) => s(wine[k]) && `${k}: ${s(wine[k])}`).filter(Boolean).join(" | ");

  const { data: callRow } = await admin.from("ai_calls").insert({ user_id: user.id, kind: "visual" }).select("id").single();
  const client = new Anthropic({ apiKey });
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 3000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM }],
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: body.image } },
        { type: "text", text: `Image : ${Math.round(w)} × ${Math.round(h)} px.\nVin : ${about || "inconnu"}` },
      ] }],
    });
  } catch (e) {
    console.error("anthropic error", e);
    await admin.from("ai_calls").update({ ok: false }).eq("id", callRow?.id);
    return json(req, { error: "ai", message: "L'analyse ne répond pas. Placez les coins à la main." }, 502);
  }
  console.log("usage", JSON.stringify(msg.usage));
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  let raw: { corners?: unknown; shape?: unknown; body?: unknown; capsule?: unknown; confidence?: unknown } = {};
  try { raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* réponse illisible */ }
  await admin.from("ai_calls").update({ ok: true }).eq("id", callRow?.id);

  // Coins ramenés en coordonnées 0–1 ; rejetés s'ils sortent de l'image ou forment une surface minuscule.
  let corners: number[][] | null = null;
  if (Array.isArray(raw.corners) && raw.corners.length === 4) {
    const p = raw.corners.map((c) => Array.isArray(c) ? [Number(c[0]) / w, Number(c[1]) / h] : [NaN, NaN]);
    const area = Math.abs(p.reduce((a, c, i) => a + c[0] * p[(i + 1) % 4][1] - p[(i + 1) % 4][0] * c[1], 0)) / 2;
    if (p.every((c) => c.every((n) => Number.isFinite(n) && n >= -0.02 && n <= 1.02)) && area > 0.01)
      corners = p.map((c) => c.map((n) => Math.min(1, Math.max(0, Math.round(n * 1000) / 1000))));
  }
  const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
  const conf = Number(raw.confidence);
  return json(req, {
    corners,
    shape: SHAPES.includes(String(raw.shape)) ? raw.shape : null,
    body: hex(raw.body),
    capsule: hex(raw.capsule),
    confidence: Number.isFinite(conf) && conf >= 0 && conf <= 1 ? conf : null,
  });
});
