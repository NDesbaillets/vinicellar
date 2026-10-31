// Vinicellar · identification d'une bouteille à partir d'une photo d'étiquette (ou d'un nom),
// puis recherche web pour remplir la fiche : producteur, cépages, garde, accords, note moyenne, prix, image.
//
// Secrets requis (Edge Functions > Secrets) : ANTHROPIC_API_KEY.
// Optionnel : AI_DAILY_LIMIT (défaut 30 analyses par utilisateur et par 24 h).
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.

import Anthropic from "npm:@anthropic-ai/sdk@0.121.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = ["https://vinicellar.ch", "https://www.vinicellar.ch", "http://localhost:8000"];
const MODEL = "claude-sonnet-5-5";
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "30");

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

const SYSTEM = `Tu es sommelier et documentaliste pour Vinicellar, une application de gestion de cave (vins, whiskies, sakés, rhums, cognacs, gins, liqueurs).
On te donne une ou deux photos (étiquette, puis éventuellement contre-étiquette) et/ou un nom. Ton travail :
1. Lire les étiquettes avec soin ; la contre-étiquette porte souvent le millésime, l'assemblage, le degré et la contenance : producteur/domaine/distillerie, cuvée, millésime, appellation, degré, contenance, mentions (âge, fût, type de saké, etc.).
2. Chercher cette bouteille précise sur le web. Priorité aux sources : site officiel du producteur, puis fiches techniques, puis cavistes et revendeurs reconnus (de préférence suisses pour le prix : Mövenpick, Gerstl, Martel, Flaschenpost, Globus, Vinatis/Wine-Searcher en complément), puis Vivino/CellarTracker/Whiskybase/Sakenowa pour la note moyenne et les fenêtres de garde.
3. Trouver l'URL directe d'une image de la bouteille (fichier .jpg/.png/.webp), sur le site du producteur si possible, sinon chez un revendeur. Utilise web_fetch sur la page produit pour récupérer l'URL exacte de l'image (balise og:image ou image produit). N'invente jamais d'URL.
4. Rédiger en français, ton précis et sobre de caviste. Pas de superlatifs creux.

Règles :
- Ne jamais inventer un chiffre. Si une donnée est introuvable, mets null. Pour la fenêtre de garde, tu peux estimer à partir de l'appellation, du style et du millésime : dans ce cas window_source = "estimation", sinon cite la source.
- Prix : prix de marché actuel d'une bouteille de 75 cl (ou de la contenance indiquée), en CHF si une source suisse existe, sinon dans la devise de la source. Indique la source.
- Note moyenne : préfère une note communautaire agrégée (ex. Vivino /5) ou une moyenne de critiques (/100). Indique l'échelle et la source (ex. "Vivino, 4,1/5 sur 2 300 avis" ou "Moyenne WA 94, JS 95, Decanter 93").
- Pour un spiritueux ou un saké, les champs vin (cépages, garde) peuvent être null ; remplis details avec les informations utiles (âge, fûts, distillerie, alambic, brut de fût, filtration, riz, taux de polissage, type, SMV, etc.). Pour un spiritueux, la garde n'a pas de sens après embouteillage : drink_* = null.
- Températures en °C, années en nombres entiers.
- Pays en français (France, Suisse, Italie, Espagne…).
- Pour la France, la Suisse et l'Italie, region = exactement l'une de ces grandes régions, le détail (sous-région, AOC, DOC, commune) allant dans appellation :
  France : Alsace, Beaujolais, Bordeaux, Bourgogne, Champagne, Corse, Jura, Languedoc-Roussillon, Loire, Provence, Rhône, Savoie, Sud-Ouest.
  Suisse : Vaud, Valais, Genève, Neuchâtel, Trois-Lacs, Tessin, Suisse alémanique.
  Italie : Piémont, Vallée d'Aoste, Lombardie, Trentin-Haut-Adige, Vénétie, Frioul-Vénétie julienne, Ligurie, Émilie-Romagne, Toscane, Ombrie, Marches, Latium, Abruzzes, Molise, Campanie, Pouilles, Basilicate, Calabre, Sicile, Sardaigne.

Réponds uniquement avec un objet JSON (sans texte autour) qui suit exactement ce schéma :
{
  "identified": boolean,
  "confidence": nombre entre 0 et 1,
  "category": "wine"|"whisky"|"sake"|"rum"|"brandy"|"gin"|"liqueur"|"other",
  "style": "red"|"white"|"rose"|"sparkling"|"sweet"|"fortified"|"orange"|null,
  "name": "nom de la cuvée tel qu'affiché (sans le producteur si possible)",
  "producer": string|null,
  "producer_url": "site officiel"|null,
  "vintage": number|null,
  "country": string|null,
  "region": string|null,
  "appellation": string|null,
  "grapes": ["Cépage (xx %)", ...],
  "abv": number|null,
  "volume_cl": number|null,
  "image_url": string|null,
  "description": "2 à 3 phrases sur le vin et son style",
  "vinification": "2 à 3 phrases : récolte, fermentation, élevage",
  "terroir": "2 à 3 phrases : sols, exposition, climat",
  "vintage_notes": "1 à 2 phrases sur le millésime ou les particularités de cette cuvée",
  "pairings": ["accord 1", "accord 2", "accord 3", "accord 4"],
  "serving_temp_min": number|null,
  "serving_temp_max": number|null,
  "drink_from": number|null,
  "drink_to": number|null,
  "peak_from": number|null,
  "peak_to": number|null,
  "aging_potential_years": number|null,
  "window_source": string|null,
  "avg_score": number|null,
  "avg_score_scale": 5|10|20|100|null,
  "avg_score_source": string|null,
  "market_price": number|null,
  "market_currency": "CHF"|"EUR"|"USD"|"GBP"|null,
  "price_source": string|null,
  "details": { "clé": "valeur" },
  "caveats": "ce qui reste incertain (ex. millésime illisible)"|null
}`;

type Img = { data: string; media_type: string };
type Payload = {
  image?: string;        // ancienne forme : une photo en base64 sans préfixe data:
  media_type?: string;
  images?: Img[];        // une ou deux photos : étiquette, contre-étiquette
  draft_id?: string;     // file d'analyses : les photos sont lues dans le stockage, le résultat est écrit dans la ligne
  hint?: { name?: string; producer?: string; vintage?: number | string; category?: string };
};
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function b64(buf: Uint8Array) {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

const num = (v: unknown, min = -Infinity, max = Infinity) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const int = (v: unknown, min?: number, max?: number) => { const n = num(v, min, max); return n === null ? null : Math.round(n); };
const str = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const strs = (v: unknown, n = 12) => (Array.isArray(v) ? v.map((x) => str(x, 200)).filter(Boolean).slice(0, n) as string[] : []);
const oneOf = <T extends string>(v: unknown, list: readonly T[]) => (list.includes(v as T) ? (v as T) : null);
const url = (v: unknown) => { const s = str(v, 1000); try { return s && /^https?:/.test(new URL(s).protocol) ? s : null; } catch { return null; } };

function clean(raw: Record<string, unknown>) {
  const details: Record<string, string> = {};
  if (raw.details && typeof raw.details === "object") {
    for (const [k, v] of Object.entries(raw.details as Record<string, unknown>).slice(0, 20)) {
      const s = typeof v === "number" ? String(v) : str(v, 300);
      if (s) details[k.slice(0, 60)] = s;
    }
  }
  return {
    identified: raw.identified === true,
    confidence: num(raw.confidence, 0, 1),
    category: oneOf(raw.category, ["wine", "whisky", "sake", "rum", "brandy", "gin", "liqueur", "other"] as const) ?? "wine",
    style: oneOf(raw.style, ["red", "white", "rose", "sparkling", "sweet", "fortified", "orange"] as const),
    name: str(raw.name, 200),
    producer: str(raw.producer, 200),
    producer_url: url(raw.producer_url),
    vintage: int(raw.vintage, 1800, 2100),
    country: str(raw.country, 80),
    region: str(raw.region, 120),
    appellation: str(raw.appellation, 160),
    grapes: strs(raw.grapes),
    abv: num(raw.abv, 0, 100),
    volume_cl: int(raw.volume_cl, 1, 3000),
    image_url: url(raw.image_url),
    description: str(raw.description),
    vinification: str(raw.vinification),
    terroir: str(raw.terroir),
    vintage_notes: str(raw.vintage_notes),
    pairings: strs(raw.pairings, 8),
    serving_temp_min: int(raw.serving_temp_min, -5, 30),
    serving_temp_max: int(raw.serving_temp_max, -5, 30),
    drink_from: int(raw.drink_from, 1800, 2200),
    drink_to: int(raw.drink_to, 1800, 2200),
    peak_from: int(raw.peak_from, 1800, 2200),
    peak_to: int(raw.peak_to, 1800, 2200),
    aging_potential_years: int(raw.aging_potential_years, 0, 200),
    window_source: str(raw.window_source, 200),
    avg_score: num(raw.avg_score, 0, 100),
    avg_score_scale: [5, 10, 20, 100].includes(Number(raw.avg_score_scale)) ? Number(raw.avg_score_scale) : null,
    avg_score_source: str(raw.avg_score_source, 300),
    market_price: num(raw.market_price, 0, 1_000_000),
    market_currency: oneOf(raw.market_currency, ["CHF", "EUR", "USD", "GBP"] as const),
    price_source: str(raw.price_source, 300),
    details,
    caveats: str(raw.caveats, 500),
  };
}

// Télécharge l'image trouvée et la range dans le dossier privé de l'utilisateur :
// les sites bloquent souvent l'affichage depuis un autre domaine, et les URL changent.
// deno-lint-ignore no-explicit-any
async function saveBottleImage(admin: any, userId: string, imageUrl: string) {
  try {
    const u = new URL(imageUrl);
    if (u.protocol !== "https:" || /^(localhost|[\d.]+|\[.*\])$/i.test(u.hostname) || !u.hostname.includes(".")) return null;
    const res = await fetch(u, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Vinicellar/1.0)", "Accept": "image/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!res.ok || !/^image\/(jpeg|png|webp|avif|gif)$/.test(type)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 2_000 || buf.byteLength > 6_000_000) return null;
    const ext = type.split("/")[1].replace("jpeg", "jpg");
    const path = `${userId}/bottle-${crypto.randomUUID()}.${ext}`;
    const { error } = await admin.storage.from("labels").upload(path, buf, { contentType: type });
    return error ? null : path;
  } catch {
    return null;
  }
}

class Fail extends Error { constructor(public status: number, message: string) { super(message); } }

// Analyse complète : lecture des photos, recherche web, fiche nettoyée, image de bouteille sauvegardée.
// deno-lint-ignore no-explicit-any
async function analyse(admin: any, apiKey: string, userId: string, images: Img[], hint: NonNullable<Payload["hint"]>) {
  const hintText = [hint.producer, hint.name, hint.vintage].filter(Boolean).join(" · ");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  images.slice(0, 2).forEach((im) => {
    const media = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(im.media_type) ? im.media_type : "image/jpeg") as
      "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    content.push({ type: "image", source: { type: "base64", media_type: media, data: im.data } });
  });
  content.push({
    type: "text",
    text: [
      images.length === 2 ? "Photo 1 : étiquette. Photo 2 : contre-étiquette." : images.length ? "Voici la photo de l'étiquette." : "Pas de photo : identifie la bouteille à partir de ces informations.",
      hintText ? `Indications de l'utilisateur (prioritaires si elles contredisent ta lecture) : ${hintText}${hint.category ? ` · catégorie ${hint.category}` : ""}.` : "",
      `Année en cours : ${new Date().getFullYear()}.`,
      "Fais tes recherches puis réponds avec le JSON demandé.",
    ].filter(Boolean).join("\n"),
  });

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
  const sources = new Map<string, string>();
  let final: Anthropic.Beta.BetaMessage | null = null;
  try {
    // Les outils web tournent côté Anthropic ; une longue recherche peut s'interrompre (pause_turn) : on relance.
    for (let i = 0; i < 4; i++) {
      final = await client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: SYSTEM,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 6 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, max_content_tokens: 20000 },
        ],
        messages,
      }).finalMessage();
      for (const block of final.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === "web_search_result") sources.set(r.url, r.title);
        }
      }
      if (final.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: final.content });
    }
  } catch (e) {
    console.error("anthropic error", e);
    throw new Fail(e instanceof Anthropic.RateLimitError ? 429 : 502, "Le service d'analyse ne répond pas. Réessayez dans un instant.");
  }
  if (!final || final.stop_reason === "refusal") throw new Fail(422, "Analyse impossible pour cette image.");
  const text = final.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  const raw = extractJson(text);
  if (!raw) throw new Fail(502, "Réponse illisible. Réessayez ou saisissez le vin à la main.");
  const result = clean(raw);
  const bottle_path = result.image_url ? await saveBottleImage(admin, userId, result.image_url) : null;
  return { result, bottle_path, sources: [...sources].slice(0, 15).map(([u, title]) => ({ url: u, title })) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json(req, { error: "not_configured", message: "Clé ANTHROPIC_API_KEY absente des secrets." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (!user) return json(req, { error: "auth" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("ai_calls").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).in("kind", ["identify", "refresh"]).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) {
    return json(req, { error: "quota", message: `Limite de ${DAILY_LIMIT} analyses par 24 h atteinte.` }, 429);
  }

  let body: Payload;
  try { body = await req.json(); } catch { return json(req, { error: "bad_request" }, 400); }
  let hint = body.hint ?? {};
  let images: Img[] = Array.isArray(body.images)
    ? body.images.filter((i) => typeof i?.data === "string" && i.data.length > 100).slice(0, 2)
    : typeof body.image === "string" && body.image.length > 100 ? [{ data: body.image, media_type: body.media_type ?? "image/jpeg" }] : [];

  // File d'analyses : la ligne doit être visible par l'utilisateur (règles RLS), les photos sont relues dans le stockage.
  let draftId: string | null = null;
  if (body.draft_id) {
    const { data: draft } = await sb.from("drafts").select("id, photo_paths, hint").eq("id", body.draft_id).single();
    if (!draft) return json(req, { error: "not_found" }, 404);
    draftId = draft.id;
    hint = { ...(draft.hint ?? {}), ...hint };
    images = [];
    for (const path of (draft.photo_paths ?? []).slice(0, 2)) {
      const { data: file } = await admin.storage.from("labels").download(path);
      if (file) images.push({ data: b64(new Uint8Array(await file.arrayBuffer())), media_type: file.type || "image/jpeg" });
    }
  }
  const hintText = [hint.producer, hint.name, hint.vintage].filter(Boolean).join("");
  if (!images.length && !hintText) return json(req, { error: "bad_request", message: "Photo ou nom requis." }, 400);
  if (images.reduce((a, i) => a + i.data.length, 0) > 12_000_000) return json(req, { error: "too_large" }, 413);

  const { data: callRow } = await admin.from("ai_calls").insert({ user_id: user.id, kind: images.length ? "identify" : "refresh" }).select("id").single();
  const run = analyse(admin, apiKey, user.id, images, hint);

  if (draftId) {
    const job = run
      .then(async (r) => {
        await admin.from("drafts").update({ status: "ready", result: r.result, bottle_path: r.bottle_path, sources: r.sources, error: null }).eq("id", draftId);
        await admin.from("ai_calls").update({ ok: true }).eq("id", callRow?.id);
      })
      .catch(async (e) => {
        await admin.from("drafts").update({ status: "error", error: e instanceof Fail ? e.message : "Analyse impossible." }).eq("id", draftId);
        await admin.from("ai_calls").update({ ok: false }).eq("id", callRow?.id);
      });
    if (typeof EdgeRuntime !== "undefined") { EdgeRuntime.waitUntil(job); return json(req, { queued: true }, 202); }
    await job;
    return json(req, { queued: true }, 202);
  }

  try {
    const r = await run;
    await admin.from("ai_calls").update({ ok: true }).eq("id", callRow?.id);
    return json(req, r);
  } catch (e) {
    await admin.from("ai_calls").update({ ok: false }).eq("id", callRow?.id);
    return json(req, { error: "ai", message: e instanceof Fail ? e.message : "Analyse impossible." }, e instanceof Fail ? e.status : 502);
  }
});
