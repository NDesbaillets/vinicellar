// ARÔMES V&N · recipe-public : lecture seule d'une recette partagée par lien, SANS compte.
// GET ?t=<jeton> -> JSON de la recette. 404 si le jeton est inconnu, révoqué, ou la recette supprimée.
// Déploiement : verify_jwt DÉSACTIVÉ (--no-verify-jwt) : seule exception justifiée, l'accès est anonyme par conception.
// Le service_role ne sert qu'à lire la recette liée à un jeton valide ; la réponse ne contient ni notes, ni membres,
// ni e-mails, ni identifiant de carnet, ni cuissons, ni photo de page, ni chemin Storage.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const BUCKET = "recipes";
const SIGNED_SECONDS = 3600;                     // URL signées des photos : 1 h
const EXCLUDED_KINDS = ["page", "cuisson"];      // photo de page imprimée/manuscrite et photos de cuisson : jamais publiques
const TOKEN = /^[A-Za-z0-9_-]{43}$/;             // 32 octets en base64url
const RATE_MAX = 60;                             // requêtes par IP et par minute, par instance de la fonction
const RATE_WINDOW_MS = 60_000;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const headers = (extra: Record<string, string> = {}) => ({
  "Access-Control-Allow-Origin": "*",            // lecture publique : pas de cookie ni d'en-tête d'autorisation
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Type": "application/json; charset=utf-8",
  ...extra,
});
const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: headers(extra) });
const notFound = () => reply(404, { error: "not_found", message: "Ce lien n'existe pas ou n'est plus actif." }, { "Cache-Control": "no-store" });

// Limitation par IP sans table : compteur en mémoire de l'instance (best effort ; plusieurs instances
// ont chacune leur compteur). Le jeton de 256 bits rend de toute façon l'énumération impossible.
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > RATE_WINDOW_MS) hits.delete(k);
  const h = hits.get(ip);
  if (!h || now - h.t > RATE_WINDOW_MS) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > RATE_MAX;
}

const safeUrl = (u: unknown): string | null => {
  if (typeof u !== "string") return null;
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
  if (req.method !== "GET") return reply(405, { error: "method", message: "Méthode non autorisée." });

  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "inconnue").trim();
  if (limited(ip)) return reply(429, { error: "rate", message: "Trop de requêtes : réessayez dans une minute." }, { "Retry-After": "60", "Cache-Control": "no-store" });

  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!TOKEN.test(t)) return notFound();

  const { data: link } = await admin.from("recipe_public_links").select("recipe_id").eq("token", t).is("revoked_at", null).maybeSingle();
  if (!link) return notFound();
  const { data: r } = await admin.from("recipes")
    .select("id, title, title_original, lang_original, summary, course, cuisine, servings, servings_estimated, time_active_min, time_active_estimated, time_total_min, time_total_estimated, difficulty, source_type, source_url, source_author")
    .eq("id", link.recipe_id).is("deleted_at", null).maybeSingle();
  if (!r) return notFound();

  const [{ data: lines }, { data: steps }, { data: photos }] = await Promise.all([
    admin.from("recipe_ingredient_lines").select("group_label, label_original, quantity, unit, precision, optional").eq("recipe_id", r.id).order("position"),
    admin.from("recipe_steps").select("text, timer_seconds").eq("recipe_id", r.id).order("position"),
    admin.from("recipe_photos").select("storage_path, kind, is_cover, created_at").eq("recipe_id", r.id)
      .not("kind", "in", `(${EXCLUDED_KINDS.join(",")})`).order("is_cover", { ascending: false }).order("created_at"),
  ]);

  // URL signées courtes : le bucket reste privé, aucun chemin Storage n'est exposé.
  const list = photos ?? [];
  const { data: signed } = list.length
    ? await admin.storage.from(BUCKET).createSignedUrls(list.map((p) => p.storage_path), SIGNED_SECONDS)
    : { data: [] as { signedUrl: string | null }[] };
  const pics = list.map((p, i) => ({ url: signed?.[i]?.signedUrl ?? null, kind: p.kind, cover: p.is_cover }))
    .filter((p) => p.url);

  const url = safeUrl(r.source_url);
  return reply(200, {
    title: r.title,
    title_original: r.title_original,
    lang_original: r.lang_original,
    summary: r.summary,
    course: r.course,
    cuisine: r.cuisine,
    difficulty: r.difficulty,
    servings: r.servings, servings_estimated: r.servings_estimated,
    time_active_min: r.time_active_min, time_active_estimated: r.time_active_estimated,
    time_total_min: r.time_total_min, time_total_estimated: r.time_total_estimated,
    credit: { source_type: r.source_type, author: r.source_author, url },
    ingredients: lines ?? [],
    steps: steps ?? [],
    photos: pics,
    photos_expire_in: SIGNED_SECONDS,
  }, { "Cache-Control": "public, max-age=60" });
});
