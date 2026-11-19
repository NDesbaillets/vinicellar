// ARÔMES V&N · photo « studio » et illustration d'une recette (fal.ai, crédits prépayés, même clé FAL_KEY que cutout).
// - mode "studio"       : à partir d'une photo personnelle ou de cuisson (kind perso/cuisson), l'éditeur obtient la même
//                         assiette détourée sur un fond studio (nappe en lin clair, bois clair, lumière latérale douce).
// - mode "illustration" : pour une recette SANS aucune photo, image générée depuis le titre et les ingrédients principaux.
// Jamais à partir d'une photo « origine » (image d'un créateur) ni d'une page photographiée.
// Résultat : fichier <book_id>/<recipe_id>/studio-<horodatage>.jpg dans le bucket privé « recipes » + ligne recipe_photos
// (kind 'studio' ou 'illustration', is_cover toujours false : la couverture se choisit à la main).
// Secret requis : FAL_KEY. Optionnel : AI_RECIPE_STUDIO_DAILY_LIMIT (défaut 15 par personne et par 24 h, ai_calls.kind = 'recipe-studio').
// Déploiement : verify_jwt par défaut ; le JWT est en plus revérifié ici. Aucune donnée n'est gardée chez fal (sync_mode).
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const SITE = "https://vinicellar.ch";
const ORIGINS = [SITE, "https://www.vinicellar.ch", "http://localhost:8000"];
const DAILY_LIMIT = Number(Deno.env.get("AI_RECIPE_STUDIO_DAILY_LIMIT") ?? "15");
const KIND = "recipe-studio";
const BUCKET = "recipes";
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

// Endpoints fal.ai isolés ici (schémas vérifiés dans l'OpenAPI publique le 19.11.2026).
// Bria Product Shot : détoure le sujet et le replace dans une scène décrite par texte (un seul appel, pas de cutout préalable).
const STUDIO_ENDPOINT = "https://fal.run/fal-ai/bria/product-shot";
// FLUX.1 [schnell] : texte vers image, 0,003 $ par mégapixel (arrondi au mégapixel supérieur).
const ILLUSTRATION_ENDPOINT = "https://fal.run/fal-ai/flux/schnell";
// Bria n'accepte que l'anglais et pas de caractères spéciaux.
const STUDIO_SCENE =
  "on a pale linen tablecloth on a light wood table, soft diffused window light from the side, " +
  "warm neutral tones, clean editorial food photography, shallow depth of field, no text, no logo, no props with brands";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : SITE,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const fail = (req: Request, status: number, error: string, message: string) => json(req, status, { error, message });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// Texte libre (titre, ingrédients) glissé dans un prompt : sans balisage ni retour à la ligne, longueur bornée.
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[<>{}\[\]\\"`\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

type Fetched = { bytes: Uint8Array; type: string };
// fal renvoie une donnée (sync_mode) ou, à défaut, une adresse https.
async function readFalImage(out: any): Promise<Fetched | null> {
  const img = out?.images?.[0];
  const url: string | undefined = img?.url;
  if (!url) return null;
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    const type = /^data:([^;,]+)/.exec(url)?.[1] ?? img?.content_type ?? "image/png";
    return { bytes: fromBase64(url.slice(comma + 1)), type };
  }
  if (url.startsWith("https://")) {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return null;
    return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") ?? img?.content_type ?? "image/png" };
  }
  return null;
}

// Appel fal avec une relance sur erreur réseau ou 5xx.
async function callFal(endpoint: string, key: string, payload: unknown): Promise<{ res?: Response; detail?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Authorization": `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status >= 500 && attempt === 0) { await res.body?.cancel(); continue; }
      return { res };
    } catch (e) {
      console.error("recipe-studio: fal network", String(e));
      if (attempt === 1) return { detail: "network" };
    }
  }
  return { detail: "network" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return fail(req, 405, "method", "Méthode non autorisée.");
  const key = Deno.env.get("FAL_KEY");
  if (!key) return fail(req, 503, "not_configured", "Clé FAL_KEY absente des secrets.");

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!user) return fail(req, 401, "auth", "Session expirée : reconnectez-vous.");

  let body: { recipe_id?: unknown; mode?: unknown; photo_id?: unknown };
  try { body = await req.json(); } catch { return fail(req, 400, "bad_request", "Requête illisible."); }
  const recipeId = typeof body.recipe_id === "string" ? body.recipe_id : "";
  if (!UUID.test(recipeId)) return fail(req, 400, "bad_request", "Recette invalide.");
  const mode = body.mode;
  if (mode !== "studio" && mode !== "illustration") return fail(req, 400, "bad_request", "Mode invalide : « studio » ou « illustration ».");
  const photoId = typeof body.photo_id === "string" ? body.photo_id : "";
  if (mode === "studio" && !UUID.test(photoId)) return fail(req, 400, "bad_request", "Choisissez la photo à mettre en scène.");

  // Recette et droits : un non-membre reçoit 404 (on ne révèle pas l'existence), un lecteur 403.
  const { data: recipe } = await admin.from("recipes").select("id, book_id, title, deleted_at").eq("id", recipeId).maybeSingle();
  if (!recipe) return fail(req, 404, "not_found", "Recette introuvable.");
  const { data: member } = await admin.from("recipe_book_members").select("role")
    .eq("book_id", recipe.book_id).eq("user_id", user.id).maybeSingle();
  if (!member) return fail(req, 404, "not_found", "Recette introuvable.");
  if (member.role !== "owner" && member.role !== "member") return fail(req, 403, "forbidden", "Seuls les membres qui peuvent modifier le carnet créent une photo studio.");
  if (recipe.deleted_at) return fail(req, 400, "bad_request", "Cette recette est dans la corbeille.");

  // Contrôles propres au mode, avant d'entamer le quota.
  let source: Fetched | null = null;
  let prompt = "";
  if (mode === "studio") {
    const { data: photo } = await admin.from("recipe_photos").select("id, recipe_id, storage_path, kind")
      .eq("id", photoId).eq("recipe_id", recipeId).maybeSingle();
    if (!photo) return fail(req, 404, "not_found", "Photo introuvable.");
    if (photo.kind === "origine") return fail(req, 403, "forbidden", "L'image d'un créateur ne se retouche pas : choisissez une de vos photos.");
    if (photo.kind !== "perso" && photo.kind !== "cuisson") return fail(req, 400, "bad_request", "Seule une photo personnelle ou de cuisson peut devenir une photo studio.");
    if (!photo.storage_path.startsWith(`${recipe.book_id}/${recipe.id}/`)) return fail(req, 400, "bad_request", "Photo invalide.");
    const dl = await admin.storage.from(BUCKET).download(photo.storage_path);
    if (dl.error || !dl.data) return fail(req, 404, "not_found", "Fichier de la photo introuvable.");
    if (dl.data.size > MAX_SOURCE_BYTES) return fail(req, 400, "too_large", "Photo trop lourde (8 Mo maximum).");
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const ext = photo.storage_path.split(".").pop()?.toLowerCase();
    const type = ["image/jpeg", "image/png", "image/webp"].includes(dl.data.type) ? dl.data.type
      : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "";
    if (!type) return fail(req, 400, "bad_request", "Format de photo non pris en charge (JPEG, PNG ou WebP).");
    source = { bytes, type };
  } else {
    const { count } = await admin.from("recipe_photos").select("id", { count: "exact", head: true }).eq("recipe_id", recipeId);
    if ((count ?? 0) > 0) return fail(req, 400, "has_photos", "Cette recette a déjà des photos : l'illustration n'est proposée que sans photo.");
    const { data: lines } = await admin.from("recipe_ingredient_lines").select("label_original, optional")
      .eq("recipe_id", recipeId).order("position").limit(30);
    const main = (lines ?? []).filter((l) => !l.optional).slice(0, 6).map((l) => clean(l.label_original, 60)).filter(Boolean);
    prompt = `Editorial food photograph of the dish "${clean(recipe.title, 120)}"` +
      (main.length ? `, made with ${main.join(", ")}` : "") +
      ", served on a ceramic plate on a pale linen tablecloth on a light wood table, soft diffused window light from the side, " +
      "natural and appetizing, shallow depth of field, no text, no logo, no watermark, no people";
  }

  // Limite par personne et par 24 h.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: used } = await admin.from("ai_calls").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("kind", KIND).gte("created_at", since);
  if ((used ?? 0) >= DAILY_LIMIT) return fail(req, 429, "quota", `Limite de ${DAILY_LIMIT} photos studio par 24 h atteinte.`);
  const { data: callRow } = await admin.from("ai_calls").insert({ user_id: user.id, kind: KIND }).select("id").single();
  const done = (ok: boolean) => admin.from("ai_calls").update({ ok }).eq("id", callRow?.id);

  const payload = mode === "studio"
    ? {
      image_url: `data:${source!.type};base64,${toBase64(source!.bytes)}`,
      scene_description: STUDIO_SCENE,
      placement_type: "original",        // garde le cadrage de la photo ; shot_size est alors ignoré
      optimize_description: true,
      num_results: 1,
      sync_mode: true,
    }
    : { prompt, image_size: "portrait_4_3", num_inference_steps: 4, num_images: 1, output_format: "jpeg", enable_safety_checker: true, sync_mode: true };

  const { res } = await callFal(mode === "studio" ? STUDIO_ENDPOINT : ILLUSTRATION_ENDPOINT, key, payload);
  if (!res) {
    await done(false);
    return fail(req, 502, "service", "Le service d'images ne répond pas. Réessayez dans un instant.");
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error("recipe-studio: fal", res.status, detail);
    await done(false);
    const msg = res.status === 401 ? "Clé FAL_KEY refusée par fal.ai."
      : res.status === 402 || res.status === 403 || /balance|credit|locked/i.test(detail) ? "Crédit fal.ai épuisé : rechargez le compte."
      : mode === "studio" ? "Mise en scène impossible pour cette photo." : "Illustration impossible pour cette recette.";
    return fail(req, 502, "service", msg);
  }

  let img: Fetched | null = null;
  try { img = await readFalImage(await res.json()); } catch (e) { console.error("recipe-studio: lecture fal", String(e)); }
  if (!img || img.bytes.length < 500) { await done(false); return fail(req, 502, "service", "Réponse du service d'images illisible."); }

  // Le cadrage veut du JPEG : Bria renvoie du PNG, on le réencode. Repli : on garde le fichier tel quel (bucket : png accepté).
  let bytes = img.bytes, contentType = img.type.split(";")[0], ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  if (contentType !== "image/jpeg") {
    try {
      const decoded = await Image.decode(img.bytes);
      bytes = await decoded.encodeJPEG(88);
      contentType = "image/jpeg"; ext = "jpg";
    } catch (e) { console.error("recipe-studio: réencodage JPEG impossible, fichier conservé", String(e)); }
  }

  const path = `${recipe.book_id}/${recipe.id}/studio-${Date.now()}.${ext}`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (up.error) {
    console.error("recipe-studio: upload", up.error.message);
    await done(false);
    return fail(req, 502, "storage", "L'image n'a pas pu être enregistrée. Réessayez.");
  }
  const kind = mode === "studio" ? "studio" : "illustration";
  const { data: row, error: pe } = await admin.from("recipe_photos")
    .insert({ recipe_id: recipe.id, storage_path: path, kind, is_cover: false, created_by: user.id }).select("id").single();
  if (pe || !row) {
    console.error("recipe-studio: recipe_photos", pe?.message);
    await admin.storage.from(BUCKET).remove([path]);
    await done(false);
    return fail(req, 502, "storage", "L'image n'a pas pu être enregistrée. Réessayez.");
  }
  await done(true);
  return json(req, 200, { photo_id: row.id, storage_path: path });
});
