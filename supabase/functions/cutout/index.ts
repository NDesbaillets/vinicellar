// Vinicellar · détourage d'une vraie photo de bouteille (Bria RMBG 2.0 via fal.ai, crédits prépayés).
// Le navigateur envoie la photo recadrée sur la bouteille ; on renvoie un PNG transparent. Rien n'est stocké ici,
// et sync_mode évite que fal garde l'image dans son historique.
// Secret requis : FAL_KEY. Optionnel : AI_CUTOUT_DAILY_LIMIT (défaut 30 par utilisateur et par 24 h).

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = ["https://vinicellar.ch", "https://www.vinicellar.ch", "http://localhost:8000"];
const DAILY_LIMIT = Number(Deno.env.get("AI_CUTOUT_DAILY_LIMIT") ?? "30");
const ENDPOINT = "https://fal.run/fal-ai/bria/background/remove";   // 0,018 $ par image (sans prompt)

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  const key = Deno.env.get("FAL_KEY");
  if (!key) return json(req, { error: "not_configured", message: "Clé FAL_KEY absente des secrets." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (!user) return json(req, { error: "auth" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("ai_calls").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("kind", "cutout").gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return json(req, { error: "quota", message: `Limite de ${DAILY_LIMIT} détourages par 24 h atteinte.` }, 429);

  let body: { image?: string };
  try { body = await req.json(); } catch { return json(req, { error: "bad_request" }, 400); }
  if (typeof body.image !== "string" || body.image.length < 100) return json(req, { error: "bad_request", message: "Photo requise." }, 400);
  if (body.image.length > 8_000_000) return json(req, { error: "too_large", message: "Photo trop lourde." }, 413);

  const { data: callRow } = await admin.from("ai_calls").insert({ user_id: user.id, kind: "cutout" }).select("id").single();
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: `data:image/jpeg;base64,${body.image}`, sync_mode: true }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    console.error("fal network", e);
    await admin.from("ai_calls").update({ ok: false }).eq("id", callRow?.id);
    return json(req, { error: "service", message: "Le détourage ne répond pas. Réessayez." }, 502);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error("fal", res.status, detail);
    await admin.from("ai_calls").update({ ok: false }).eq("id", callRow?.id);
    const msg = res.status === 401 ? "Clé FAL_KEY refusée par fal.ai."
      : res.status === 402 || res.status === 403 || /balance|credit|locked/i.test(detail) ? "Crédit fal.ai épuisé : rechargez le compte."
      : "Détourage impossible pour cette photo.";
    return json(req, { error: "service", message: msg }, 502);
  }
  const out = await res.json();
  const url: string | undefined = out?.image?.url;
  let png: string | null = null;
  if (url?.startsWith("data:")) png = url.slice(url.indexOf(",") + 1);
  else if (url?.startsWith("https://")) {                        // au cas où fal renverrait une adresse plutôt qu'une donnée
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); png = btoa(s); }
  }
  if (!png) { await admin.from("ai_calls").update({ ok: false }).eq("id", callRow?.id); return json(req, { error: "service", message: "Réponse de détourage illisible." }, 502); }
  await admin.from("ai_calls").update({ ok: true }).eq("id", callRow?.id);
  return json(req, { png });
});
