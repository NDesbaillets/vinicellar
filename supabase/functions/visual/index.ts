// Vinicellar · visuel propre d'une bouteille : l'IA repère l'étiquette (et la collerette) et décrit la bouteille ;
// le navigateur détoure l'étiquette et la pose sur une bouteille vierge photoréaliste. Aucune image n'est générée ni stockée ici.
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

const SYSTEM = `On te donne la photo d'une étiquette ou d'une bouteille (vin, champagne, spiritueux), ses dimensions en pixels et ce que l'on sait du vin. Coordonnées en pixels de l'image.
1. label : étiquette principale (face avant). pts : six points du cadre qui l'englobe au plus près, aligné sur la bouteille et non sur le dessin de l'étiquette : côtés gauche et droit parallèles à l'axe de la bouteille, bords haut et bas qui suivent les cercles horizontaux du verre (courbes en perspective). Ordre : coin haut gauche, milieu du bord haut, coin haut droite, coin bas droite, milieu du bord bas, coin bas gauche. Étiquette à plat : cadre aligné sur le texte. outline : 12 à 24 points qui suivent le bord réel du papier (biais, coins arrondis, arc, ovale, découpes), dans le sens horaire depuis le haut gauche ; c'est lui qui porte la forme. on_bottle = true si l'étiquette est sur une bouteille, false si elle est à plat. Introuvable : null.
2. neck_label : examine le col entre la capsule et les épaules. Une collerette est une bande de papier distincte qui entoure le col (souvent colorée, avec le millésime ou le nom) ; si tu en vois une, donne ses six points et son contour comme pour l'étiquette. Seulement si le col est nu : null.
3. shape : bordeaux (épaules marquées), burgundy (épaules tombantes), champagne (mousseux), alsace (flûte haute et fine) ou spirit. Bouteille invisible : déduis-la de l'appellation, de la région et du type.
4. glass : darkgreen, green, olive (feuille-morte), amber ou flint (incolore) ; liquid : red, white, rose, amber ou clear. Invisibles : l'usage le plus probable pour ce vin.
5. closure : type foil (capsule), screwcap (capsule à vis), champagne (coiffe et muselet), wax (cire), stopper (bouchon à tête) ou none ; color = couleur hexadécimale dominante. Invisible : l'usage le plus probable.
Réponds uniquement par ce JSON : {"neck_label":{"pts":[...],"outline":[...]}|null,"label":{"pts":[[x,y],[x,y],[x,y],[x,y],[x,y],[x,y]],"outline":[[x,y],...],"on_bottle":true}|null,"shape":"","glass":"","liquid":"","closure":{"type":"","color":"#rrggbb"},"confidence":0-1}`;

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
      max_tokens: 4000,
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
  let raw: Record<string, any> = {};
  try { raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* réponse illisible */ }
  await admin.from("ai_calls").update({ ok: true }).eq("id", callRow?.id);

  // Six points ramenés en coordonnées 0–1 ; rejetés s'ils sortent de l'image ou délimitent une surface minuscule.
  const grid = (g: any) => {
    if (!g || !Array.isArray(g.pts) || g.pts.length !== 6) return null;
    const p = g.pts.map((c: any) => Array.isArray(c) ? [Number(c[0]) / w, Number(c[1]) / h] : [NaN, NaN]);
    const q = [p[0], p[2], p[3], p[5]];
    const area = Math.abs(q.reduce((a: number, c: number[], i: number) => a + c[0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * c[1], 0)) / 2;
    if (!p.every((c: number[]) => c.every((n) => Number.isFinite(n) && n >= -0.03 && n <= 1.03)) || area < 0.0002) return null;
    const norm = (c: number[]) => c.map((n) => Math.min(1, Math.max(0, Math.round(n * 1000) / 1000)));
    const o = Array.isArray(g.outline) && g.outline.length >= 8 && g.outline.length <= 40
      ? g.outline.map((c: any) => Array.isArray(c) ? [Number(c[0]) / w, Number(c[1]) / h] : [NaN, NaN]) : null;
    const outline = o && o.every((c: number[]) => c.every((n) => Number.isFinite(n) && n >= -0.03 && n <= 1.03)) ? o.map(norm) : null;
    return { pts: p.map(norm), outline, on_bottle: g.on_bottle !== false };
  };
  const pick = (v: unknown, list: string[]) => (list.includes(String(v)) ? String(v) : null);
  const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
  const conf = Number(raw.confidence);
  return json(req, {
    label: grid(raw.label),
    neck_label: grid(raw.neck_label),
    shape: pick(raw.shape, SHAPES),
    glass: pick(raw.glass, ["darkgreen", "green", "olive", "amber", "flint"]),
    liquid: pick(raw.liquid, ["red", "white", "rose", "amber", "clear"]),
    closure: raw.closure ? { type: pick(raw.closure.type, ["foil", "screwcap", "champagne", "wax", "stopper", "none"]), color: hex(raw.closure.color) } : null,
    confidence: Number.isFinite(conf) && conf >= 0 && conf <= 1 ? conf : null,
  });
});
