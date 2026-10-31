// Vinicellar · le propriétaire d'une cave invite une personne à la partager.
// Si la personne n'a pas de compte, elle reçoit l'e-mail d'invitation Supabase (l'invitation vaut validation).
// Si elle en a un, l'invitation s'affiche à sa prochaine connexion.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SITE = "https://vinicellar.ch";
const ORIGINS = [SITE, "https://www.vinicellar.ch", "http://localhost:8000"];
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method" });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return json(req, 401, { error: "auth" });

  let body: { collection_id?: string; email?: string; role?: string };
  try { body = await req.json(); } catch { return json(req, 400, { error: "invalid_json" }); }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, 400, { error: "email", message: "Adresse e-mail invalide." });
  if (email === (user.email ?? "").toLowerCase()) return json(req, 400, { error: "self", message: "C'est votre propre adresse." });

  const { data: m } = await admin.from("collection_members").select("role").eq("collection_id", body.collection_id ?? "").eq("user_id", user.id).single();
  if (m?.role !== "owner") return json(req, 403, { error: "forbidden" });

  // Niveau d'accès : complet (member) ou lecture seule (viewer). Une nouvelle invitation met à jour le niveau d'une invitation en attente.
  const role = body.role === "viewer" ? "viewer" : "member";
  const { error: ie } = await admin.from("collection_invites")
    .upsert({ collection_id: body.collection_id, email, invited_by: user.id, role, accepted_at: null }, { onConflict: "collection_id,email" });
  if (ie) { console.error(ie); return json(req, 500, { error: "db" }); }

  const { data: prof } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE}/bienvenue.html`, data: { invited_by: prof?.full_name ?? user.email },
  });
  const existing = !!error && /already (been )?registered|exists/i.test(error.message);
  if (error && !existing) { console.error(error); return json(req, 502, { error: "invite", message: "Invitation enregistrée, mais l'e-mail n'a pas pu partir." }); }
  return json(req, 200, { ok: true, existing });
});
