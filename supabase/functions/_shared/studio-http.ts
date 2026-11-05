import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { StudioError } from "./studio-contract.mjs";

export function headers(req: Request) {
  const allowed = (Deno.env.get("STUDIO_ORIGINS") || "https://vinicellar.ch,https://www.vinicellar.ch").split(",");
  const origin = req.headers.get("Origin") || "";
  return { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin", "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : "https://vinicellar.ch", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
}
export function reply(req: Request, value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: headers(req) }); }
export async function session(req: Request) {
  if (Deno.env.get("STUDIO_ENABLED") !== "true") throw new StudioError("Studio n'est pas encore activé sur cet environnement.", 503);
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new StudioError("Connexion requise.", 401);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await userClient.auth.getUser(authorization.slice(7));
  if (error || !user) throw new StudioError("Session invalide.", 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return { userClient, admin, user };
}
export function endpoint(run: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(req) });
    if (req.method !== "POST") return reply(req, { message: "Méthode non autorisée." }, 405);
    try { return await run(req); }
    catch (e) { return reply(req, { message: e instanceof StudioError ? e.message : "Opération Studio impossible. Réessayez." }, e instanceof StudioError ? e.status : 500); }
  };
}
