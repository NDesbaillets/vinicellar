// Vinicellar · l'admin valide (envoi de l'e-mail d'invitation Supabase) ou refuse une demande d'invitation.
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
  const { data: me } = await admin.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) return json(req, 403, { error: "forbidden" });

  let body: { id?: string; action?: string };
  try { body = await req.json(); } catch { return json(req, 400, { error: "invalid_json" }); }
  const { data: r } = await admin.from("access_requests").select("*").eq("id", body.id ?? "").single();
  if (!r) return json(req, 404, { error: "not_found" });
  if (r.status !== "pending") return json(req, 409, { error: "already_reviewed", status: r.status });

  let existing = false;
  if (body.action === "approve") {
    const { error } = await admin.auth.admin.inviteUserByEmail(r.email, { redirectTo: `${SITE}/bienvenue.html`, data: { full_name: r.name } });
    if (error) {
      if (/already (been )?registered|exists/i.test(error.message)) existing = true;
      else { console.error(error); return json(req, 502, { error: "invite", message: error.message }); }
    }
  } else if (body.action !== "decline") return json(req, 400, { error: "action" });

  await admin.from("access_requests").update({
    status: body.action === "approve" ? "approved" : "declined", reviewed_at: new Date().toISOString(), reviewed_by: user.id,
  }).eq("id", r.id);
  return json(req, 200, { ok: true, existing });
});
