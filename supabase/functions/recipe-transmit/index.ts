// ARÔMES V&N · recipe-transmit : copie une recette vers un autre carnet dont l'appelant est éditeur.
// POST { recipe_id, target_book_id } -> { recipe_id } (id de la nouvelle recette).
// Droits : membre (tout rôle) du carnet source ET éditeur (owner/member) du carnet cible, vérifiés ici avec le JWT
// (le service_role ne sert qu'à copier, après ces contrôles).
// Copié : recette (statut dérivé, « De famille », corbeille, archivage et version_group remis à défaut ; review_state
// conservé ; transmitted_from = original ; created_by = appelant), lignes, étapes, photos sauf kind 'cuisson'.
// Non copié : notes (partagées ou privées : elles appartiennent au carnet d'origine), journal des cuissons, liens publics.
// Fichiers : API Storage copy vers <carnet cible>/<nouvelle recette>/…
// Déploiement : verify_jwt par défaut (le JWT est en plus revérifié ici). Limite quotidienne dans ai_calls (kind 'recipe-transmit').
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SITE = "https://vinicellar.ch";
const ORIGINS = [SITE, "https://www.vinicellar.ch", "http://localhost:8000"];
const KIND = "recipe-transmit";
const DAILY_LIMIT = Number(Deno.env.get("RECIPE_TRANSMIT_DAILY_LIMIT") ?? "100");
const BUCKET = "recipes";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Le service_role ne vit que dans cette fonction (secret d'environnement), jamais dans une réponse ni un journal.
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

// Champs de recipes qui ne se copient pas tels quels (le reste est repris : une colonne ajoutée plus tard suit).
const RECIPE_RESET = ["id", "book_id", "search", "created_at", "updated_at", "deleted_at", "archived_at",
  "version_group", "family", "created_by", "transmitted_from"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return fail(req, 405, "method", "Méthode non autorisée.");

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!user) return fail(req, 401, "auth", "Session expirée : reconnectez-vous.");

  let body: { recipe_id?: unknown; target_book_id?: unknown };
  try { body = await req.json(); } catch { return fail(req, 400, "invalid", "Requête illisible."); }
  const recipeId = typeof body.recipe_id === "string" ? body.recipe_id : "";
  const targetBook = typeof body.target_book_id === "string" ? body.target_book_id : "";
  if (!UUID.test(recipeId)) return fail(req, 400, "invalid", "Recette invalide.");
  if (!UUID.test(targetBook)) return fail(req, 400, "invalid", "Carnet de destination invalide.");

  // Recette source (non supprimée) : 404 identique qu'elle n'existe pas ou que l'appelant n'y ait pas accès.
  const { data: src } = await admin.from("recipes").select("*").eq("id", recipeId).is("deleted_at", null).maybeSingle();
  if (!src) return fail(req, 404, "not_found", "Recette introuvable.");
  const { data: srcMember } = await admin.from("recipe_book_members").select("role")
    .eq("book_id", src.book_id).eq("user_id", user.id).maybeSingle();
  if (!srcMember) return fail(req, 404, "not_found", "Recette introuvable.");

  if (src.book_id === targetBook) return fail(req, 400, "same_book", "Choisissez un autre carnet que celui de la recette.");
  const { data: dst } = await admin.from("recipe_book_members").select("role")
    .eq("book_id", targetBook).eq("user_id", user.id).maybeSingle();
  if (!dst) return fail(req, 404, "not_found", "Carnet de destination introuvable.");
  if (dst.role !== "owner" && dst.role !== "member") {
    return fail(req, 403, "forbidden", "Vous ne pouvez pas ajouter de recette à ce carnet : il faut en être propriétaire ou membre.");
  }

  // Limite : par personne et par 24 h.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("ai_calls").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("kind", KIND).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return fail(req, 429, "quota", `Limite de ${DAILY_LIMIT} transmissions par 24 h atteinte.`);
  const { data: callRow } = await admin.from("ai_calls").insert({ user_id: user.id, kind: KIND }).select("id").single();
  const done = (ok: boolean) => admin.from("ai_calls").update({ ok }).eq("id", callRow?.id);

  const copiedFiles: string[] = [];
  let newId: string | null = null;
  const rollback = async () => {
    if (copiedFiles.length) await admin.storage.from(BUCKET).remove(copiedFiles);
    if (newId) await admin.from("recipes").delete().eq("id", newId); // lignes, étapes, photos en cascade
  };
  const abort = async (what: string, msg: string) => {
    console.error("recipe-transmit:", what, msg);
    await rollback();
    await done(false);
    return fail(req, 500, "copy_failed", "La transmission a échoué : rien n'a été ajouté. Réessayez plus tard.");
  };

  try {
    const row: Record<string, unknown> = { ...src };
    for (const k of RECIPE_RESET) delete row[k];
    const { data: created, error: re } = await admin.from("recipes").insert({
      ...row, book_id: targetBook, family: false, created_by: user.id, transmitted_from: src.id,
    }).select("id").single();
    if (re || !created) return await abort("recipe insert", re?.message ?? "pas de ligne");
    newId = created.id as string;

    const [{ data: lines }, { data: steps }, { data: photos }] = await Promise.all([
      admin.from("recipe_ingredient_lines").select("*").eq("recipe_id", src.id).order("position"),
      admin.from("recipe_steps").select("*").eq("recipe_id", src.id).order("position"),
      admin.from("recipe_photos").select("*").eq("recipe_id", src.id).neq("kind", "cuisson"),
    ]);

    const strip = (r: Record<string, unknown>) => { const { id: _i, recipe_id: _r, ...rest } = r; return { ...rest, recipe_id: newId }; };
    if (lines?.length) {
      const { error } = await admin.from("recipe_ingredient_lines").insert(lines.map(strip));
      if (error) return await abort("lines", error.message);
    }
    if (steps?.length) {
      const { error } = await admin.from("recipe_steps").insert(steps.map(strip));
      if (error) return await abort("steps", error.message);
    }

    // Photos : le fichier est copié d'abord ; la ligne n'est créée que si la copie a réussi. Un chemin qui ne
    // se trouve pas sous <carnet source>/<recette source>/ est ignoré (jamais copié depuis un autre carnet).
    const prefix = `${src.book_id}/${src.id}/`;
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const p of photos ?? []) {
      const path = String(p.storage_path ?? "");
      const rest = path.slice(prefix.length);
      if (!path.startsWith(prefix) || !rest || rest.split("/").some((s) => s === ".." || s === "." || s === "") || rest.startsWith("cuissons/")) {
        skipped++; continue;
      }
      const to = `${targetBook}/${newId}/${rest}`;
      const { error } = await admin.storage.from(BUCKET).copy(path, to);
      if (error) { console.error("recipe-transmit: copy", path, error.message); skipped++; continue; }
      copiedFiles.push(to);
      rows.push({ ...strip(p), storage_path: to, created_by: user.id });
    }
    if (rows.length) {
      const { error } = await admin.from("recipe_photos").insert(rows);
      if (error) return await abort("photos", error.message);
    }
    await done(true);
    return json(req, 200, { recipe_id: newId, photos_copied: rows.length, photos_skipped: skipped });
  } catch (e) {
    return await abort("exception", String((e as Error)?.message ?? e));
  }
});
