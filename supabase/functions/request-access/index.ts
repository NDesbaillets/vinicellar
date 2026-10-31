// Vinicellar · demande d'invitation (formulaire public de la page d'accueil).
// Enregistre la demande et prévient l'admin par e-mail ; l'admin valide ou refuse dans /app/admin.html.
// Secret facultatif : SMTP_PASSWORD (boîte noreply@vinicellar.ch). Sans lui, la demande est enregistrée sans e-mail.
import nodemailer from "npm:nodemailer@6.9.16";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SITE = "https://vinicellar.ch";
const ORIGINS = [SITE, "https://www.vinicellar.ch", "http://localhost:8000"];
const SMTP_USER = "noreply@vinicellar.ch";

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
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function notify(r: { name: string; email: string; message: string }) {
  const pass = Deno.env.get("SMTP_PASSWORD");
  if (!pass) return;
  const { data: rows } = await admin.from("profiles").select("id").eq("is_admin", true);
  const to: string[] = [];
  for (const row of rows ?? []) {
    const { data } = await admin.auth.admin.getUserById(row.id);
    if (data.user?.email) to.push(data.user.email);
  }
  if (!to.length) return;
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:540px;color:#231A17">
<p style="font-family:Georgia,serif;font-size:20px;color:#6B1E2E;margin:0 0 16px">Vinicellar</p>
<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 12px">Demande d'invitation</h1>
<p style="margin:0 0 4px"><b>${esc(r.name)}</b> · ${esc(r.email)}</p>
${r.message ? `<p style="white-space:pre-wrap;background:#F3EEE6;border-radius:10px;padding:14px;margin:12px 0">${esc(r.message)}</p>` : ""}
<p style="margin:20px 0"><a href="${SITE}/app/admin.html" style="display:inline-block;background:#6B1E2E;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Valider ou refuser</a></p></div>`;
  const transport = nodemailer.createTransport({ host: "mail.infomaniak.com", port: 465, secure: true, auth: { user: SMTP_USER, pass } });
  await transport.sendMail({
    from: `Vinicellar <${SMTP_USER}>`, to, replyTo: r.email,
    subject: `Vinicellar · Demande d'invitation · ${r.name}`,
    text: `Demande d'invitation\n\n${r.name} <${r.email}>\n\n${r.message}\n\nValider ou refuser : ${SITE}/app/admin.html`,
    html,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method" });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, 400, { error: "invalid_json" }); }
  if (text(body.website, 200)) return json(req, 200, { ok: true }); // piège anti-robot

  const r = { name: text(body.name, 120), email: text(body.email, 200).toLowerCase(), message: text(body.message, 2000) };
  if (!r.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return json(req, 400, { error: "invalid_input" });

  // Garde-fou contre les envois en masse.
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await admin.from("access_requests").select("id", { count: "exact", head: true }).gte("created_at", since);
  if ((count ?? 0) >= 30) return json(req, 429, { error: "rate" });

  const { error } = await admin.from("access_requests").insert(r);
  if (error && !/duplicate|unique/i.test(error.message)) { console.error(error); return json(req, 500, { error: "db" }); }
  if (!error) { try { await notify(r); } catch (e) { console.error("mail", e); } }
  return json(req, 200, { ok: true });
});
