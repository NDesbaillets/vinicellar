// ARÔMES V&N · le propriétaire d'un carnet invite une personne, avec ou sans compte.
// - Sans compte : compte créé + e-mail d'invitation Supabase ; la personne est ajoutée directement au carnet.
// - Avec compte : ligne recipe_book_invites ; l'invitation apparaît dans l'app (my_book_invites()).
// Déploiement : verify_jwt par défaut (comme invite-member) ; le JWT est en plus revérifié ici.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SITE = "https://vinicellar.ch";
const ORIGINS = [SITE, "https://www.vinicellar.ch", "http://localhost:8000"];
const DAILY_LIMIT = 20;
const KIND = "book-invite";
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

// Ces textes finissent dans un e-mail HTML : on retire tout ce qui ressemble à du balisage.
const plain = (v: unknown) => String(v ?? "").replace(/[<>{}&"]/g, "").trim().slice(0, 80);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return fail(req, 405, "method", "Méthode non autorisée.");

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!user) return fail(req, 401, "auth", "Session expirée : reconnectez-vous.");

  let body: { book_id?: unknown; email?: unknown; role?: unknown };
  try { body = await req.json(); } catch { return fail(req, 400, "invalid", "Requête illisible."); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(req, 400, "invalid", "Adresse e-mail invalide.");
  // Seuls member et reader sont acceptés : owner (ou toute autre valeur) est refusé, jamais ramené à un autre rôle.
  const role = body.role === undefined || body.role === null ? "member" : body.role;
  if (role !== "member" && role !== "reader") return fail(req, 400, "invalid", "Rôle invalide : choisissez membre ou lecteur.");
  const bookId = typeof body.book_id === "string" ? body.book_id : "";
  if (!UUID.test(bookId)) return fail(req, 400, "invalid", "Carnet invalide.");

  // L'appelant doit être propriétaire du carnet (lecture service_role, filtrée sur son id issu du JWT).
  const { data: mine } = await admin.from("recipe_book_members").select("role")
    .eq("book_id", bookId).eq("user_id", user.id).eq("role", "owner").maybeSingle();
  if (!mine) return fail(req, 403, "forbidden", "Seul le propriétaire du carnet peut inviter.");

  // Déjà membre ? On compare l'e-mail aux membres du carnet (liste courte), sans parcourir tous les utilisateurs.
  const { data: members } = await admin.from("recipe_book_members").select("user_id").eq("book_id", bookId).limit(200);
  const emails = await Promise.all((members ?? []).map(async (m) => {
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    return (data?.user?.email ?? "").toLowerCase();
  }));
  if (emails.includes(email)) return json(req, 200, { result: "already_member" });

  // Limite : 20 invitations par propriétaire et par 24 h (ai_calls, nom de table historique).
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("ai_calls").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("kind", KIND).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return fail(req, 429, "quota", `Limite de ${DAILY_LIMIT} invitations par 24 h atteinte.`);
  const { data: callRow } = await admin.from("ai_calls").insert({ user_id: user.id, kind: KIND }).select("id").single();
  const done = (ok: boolean) => admin.from("ai_calls").update({ ok }).eq("id", callRow?.id);

  const [{ data: prof }, { data: book }] = await Promise.all([
    admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    admin.from("recipe_books").select("name").eq("id", bookId).maybeSingle(),
  ]);

  // inviteUserByEmail échoue si l'adresse a déjà un compte (même méthode que invite-member) : c'est notre détecteur.
  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE}/recettes/bienvenue.html`,
    data: { invited_by: plain(prof?.full_name ?? user.email), app: "aromes", book_name: plain(book?.name) },
  });
  const existing = !!error && (error.code === "email_exists" || /already (been )?registered|exists/i.test(error.message));
  if (error && !existing) {
    console.error("invite-book-member: inviteUserByEmail", error.message);
    await done(false);
    return fail(req, 502, "send_failed", "L'e-mail d'invitation n'a pas pu partir. Réessayez plus tard.");
  }

  if (existing) {
    // Compte existant : invitation en attente (ou mise à jour du rôle d'une invitation précédente).
    const { error: ie } = await admin.from("recipe_book_invites")
      .upsert({ book_id: bookId, email, invited_by: user.id, role, accepted_at: null }, { onConflict: "book_id,email" });
    if (ie) { console.error("invite-book-member: invite upsert", ie.message); await done(false); return fail(req, 502, "send_failed", "Invitation non enregistrée. Réessayez plus tard."); }
    await done(true);
    return json(req, 200, { result: "pending" });
  }

  // Nouveau compte : le déclencheur lui a créé son carnet ; on l'ajoute en plus à celui-ci, avec le rôle demandé.
  const newId = invited?.user?.id;
  const { error: me } = newId
    ? await admin.from("recipe_book_members").upsert({ book_id: bookId, user_id: newId, role }, { onConflict: "book_id,user_id", ignoreDuplicates: true })
    : { error: { message: "id manquant" } };
  const { error: ie } = await admin.from("recipe_book_invites")
    .upsert({ book_id: bookId, email, invited_by: user.id, role, accepted_at: me ? null : new Date().toISOString() }, { onConflict: "book_id,email" });
  if (me) console.error("invite-book-member: member insert (repli : invitation en attente)", me.message);
  if (ie) console.error("invite-book-member: invite upsert", ie.message);
  await done(true);
  return json(req, 200, { result: "invited_new" });
});
