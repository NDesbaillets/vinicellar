// ARÔMES V&N · recipe-search : recherche en langage naturel. Claude traduit la question en filtres JSON stricts ;
// la requête s'exécute ensuite avec le JWT de l'utilisateur (RLS) via la fonction SQL recipe_search().
// Le texte de l'utilisateur est une donnée à interpréter, jamais une instruction.
// Secret requis : ANTHROPIC_API_KEY. Optionnel : AI_RECIPE_SEARCH_DAILY_LIMIT (défaut 60 par personne et par 24 h).
import Anthropic from "npm:@anthropic-ai/sdk@0.121.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { buildFilters, parseFilters, SYSTEM, type Filters } from "./lib.ts";

const ALLOWED_ORIGINS = ["https://vinicellar.ch", "https://www.vinicellar.ch", "http://localhost:8000"];
const MODEL = "claude-sonnet-5-5";
const KIND = "recipe-search";
const DAILY_LIMIT = Number(Deno.env.get("AI_RECIPE_SEARCH_DAILY_LIMIT") ?? "60");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json(req, { error: "not_configured", message: "Clé ANTHROPIC_API_KEY absente des secrets." }, 503);

  // Client au nom de l'utilisateur : la RLS s'applique à toute lecture de recettes.
  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (!user) return json(req, { error: "auth" }, 401);

  let body: { q?: unknown; book_ids?: unknown };
  try { body = await req.json(); } catch { return json(req, { error: "bad_request" }, 400); }
  // Retire toute balise de notre délimiteur : la question ne peut pas « sortir » de son bloc.
  const q = (typeof body.q === "string" ? body.q : "").replace(/<\/?question>/gi, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  if (q.length < 2) return json(req, { error: "bad_request", message: "Décrivez ce que vous cherchez." }, 400);
  let bookIds = (Array.isArray(body.book_ids) ? body.book_ids : []).filter((b): b is string => typeof b === "string" && UUID.test(b)).slice(0, 20);
  if (!bookIds.length) {
    const { data } = await sb.rpc("my_books");
    bookIds = ((data ?? []) as string[]).filter((b) => UUID.test(b));
  }
  if (!bookIds.length) return json(req, { filtres: null, recettes: [], message: "Aucun carnet." });

  // Limite quotidienne, journalisée dans ai_calls (service_role : jamais côté client).
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("ai_calls").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("kind", KIND).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return json(req, { error: "quota", message: `Limite de ${DAILY_LIMIT} recherches en langage naturel par 24 h atteinte.` }, 429);

  const { data: callRow } = await admin.from("ai_calls").insert({ user_id: user.id, kind: KIND }).select("id").single();
  const month = Number(new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone: "Europe/Zurich" }).format(new Date()));

  // 1. Question -> filtres. En cas d'échec de Claude, repli sur la recherche texte simple (signalé par degrade).
  let filtres: Filters = { texte: q, type_plat: null, cuisine: null, temps_total_max: null, difficulte_max: null,
    ingredients_inclus: [], ingredients_exclus: [], saison_mois: null, regime: null };
  let degrade = false;
  const client = new Anthropic({ apiKey });
  try {
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1500,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM(month),
      messages: [{ role: "user", content: `<question>${q}</question>` }],
    });
    console.log("usage", JSON.stringify(msg.usage));
    if (msg.stop_reason === "refusal") throw new Error("refusal");
    const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const parsed = parseFilters(text);
    if (!parsed) throw new Error("unreadable");
    filtres = parsed;
  } catch (e) {
    console.error("anthropic error", e);
    degrade = true;
  }

  // 2. Ingrédients -> catalogue (noms et alias, sans accents) ; non reconnus = recherche sur le libellé des lignes.
  const wanted = [...filtres.ingredients_inclus, ...filtres.ingredients_exclus];
  let catalog: { id: string; name: string; aliases: string[] }[] = [];
  if (wanted.length) {
    const { data } = await sb.from("recipe_ingredients_catalog").select("id, name, aliases").limit(5000);
    catalog = (data ?? []) as typeof catalog;
  }
  const f = buildFilters(filtres, catalog);

  // 3. Exécution avec le JWT de l'utilisateur.
  const { data: rows, error } = await sb.rpc("recipe_search", {
    p_book_ids: bookIds, p_texte: filtres.texte, p_course: filtres.type_plat, p_cuisine: filtres.cuisine,
    p_time_max: filtres.temps_total_max, p_diff_max: filtres.difficulte_max,
    p_inc: f.inc, p_exc: f.exc, p_inc_txt: f.incTxt, p_exc_txt: f.excTxt,
    p_month: filtres.saison_mois, p_regime: filtres.regime, p_limit: 30,
  });
  if (error) {
    console.error("recipe_search error", error);
    await admin.from("ai_calls").update({ ok: false }).eq("id", callRow?.id);
    return json(req, { error: "db", message: "La recherche a échoué. Réessayez." }, 500);
  }
  await admin.from("ai_calls").update({ ok: !degrade }).eq("id", callRow?.id);

  const recettes = ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.recipe_id, book_id: r.book_id, title: r.title, course: r.course, cuisine: r.cuisine,
    time_total_min: r.time_total_min, difficulty: r.difficulty, servings: r.servings, family: r.family, review_state: r.review_state,
  }));
  return json(req, {
    filtres,
    ingredients: { inclus: f.incNames, exclus: f.excNames, non_reconnus: [...f.incTxt, ...f.excTxt] },
    degrade,
    recettes,
  });
});
