import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Buffer } from "node:buffer";
import { type Action, dayPlus, ICloud, icloudUrl, preferredSlot, type Slot, swissDay } from "./caldav.ts";

const project = Deno.env.get("SUPABASE_URL")!;
const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(project, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = new Set(["https://vinicellar.ch", "https://www.vinicellar.ch"]);
const originDev = Deno.env.get("EUREKA_ORIGINE");
if (originDev) SITE.add(originDev);

type Binding = { espace_id: string; user_id: string };
type Calendar = { id: string; href: string; nom: string; actif: boolean; disponible: boolean; professionnel: boolean;
  modifiable: boolean; mode: string; revision: number; synchro_le: string | null };
type Pending = Slot & { rappel_id: string | null; calendrier_id: string; statut: string; etag: string | null };
type Candidate = { rappel_id: string; date_debut: string | null; date_limite: string | null;
  calendrier_id: string; heure: string; duree: number };

class Setup extends Error {}

async function value<T>(query: PromiseLike<{ data: T; error: unknown }>) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function equal(a: string, b: string) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return difference === 0;
}

function response(origin: string, body: unknown, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Vary": "Origin" },
  });
}

function apple(binding: Binding, lease: string) {
  const user = Deno.env.get("EUREKA_ICLOUD_APPLE_ID");
  const password = Deno.env.get("EUREKA_ICLOUD_APP_PASSWORD");
  if (!user || !password) throw new Setup("Les identifiants iCloud restent à configurer par le propriétaire.");
  const basic = "Basic " + Buffer.from(user + ":" + password).toString("base64");
  return new ICloud(async (initial: URL, request: RequestInit, action: Action) => {
    let url = icloudUrl(initial.href);
    for (let redirect = 0; redirect < 4; redirect++) {
      const log = await value(admin.rpc("sorties_journal_caldav", {
        p_espace: binding.espace_id, p_user: binding.user_id, p_bail: lease, p_action: action,
      }));
      if (!log) throw new Setup("La liaison est inactive ou le plafond de requêtes iCloud est atteint.");
      let ok = false;
      try {
        const headers = new Headers(request.headers);
        headers.set("Authorization", basic);
        const res = await fetch(url, { ...request, headers, redirect: "manual", signal: AbortSignal.timeout(9000) });
        ok = res.ok || res.status === 404 && request.method === "GET";
        if (![301, 302, 307, 308].includes(res.status)) return res;
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) throw new Error("Redirection CalDAV incomplète");
        const next = icloudUrl(location, url.href);
        if ((request.method === "PUT" || request.method === "DELETE") && next.pathname !== url.pathname) {
          throw new Error("La redirection change la ressource d’écriture");
        }
        url = next;
        ok = true;
      } finally {
        await admin.from("ai_calls").update({ ok }).eq("id", log);
      }
    }
    throw new Error("Trop de redirections CalDAV");
  });
}

const liaison = () => admin.from("sorties_liaison_icloud");
const creneaux = () => admin.from("sorties_creneaux_provisoires");
const dates = (now: number) => {
  const day = swissDay(now);
  return {
    day, from: preferredSlot(dayPlus(day, -1), "00:00", 30)!.debut,
    to: preferredSlot(dayPlus(day, 91), "00:00", 30)!.debut,
  };
};
const millis = (d: string) => Date.parse(d);

async function inventory(binding: Binding) {
  return (await value(admin.from("sorties_calendriers")
    .select("id,href,nom,actif,disponible,professionnel,modifiable,mode,revision,synchro_le")
    .eq("user_id", binding.user_id).order("id").limit(100)) ?? []) as Calendar[];
}

async function mirror(client: ICloud, calendars: Calendar[], range: ReturnType<typeof dates>, forced: boolean) {
  if (calendars.length > 12) throw new Setup("Activez au plus 12 calendriers dans Eurêka.");
  const fresh = (calendar: Calendar) => calendar.synchro_le && millis(calendar.synchro_le) > Date.now() - 40 * 60_000;
  const toSync = calendars.filter((calendar) => forced || !fresh(calendar));
  let errors = 0;
  for (let i = 0; i < toSync.length; i += 4) {
    const results = await Promise.allSettled(toSync.slice(i, i + 4).map(async (calendar) => {
      const started = new Date().toISOString();
      const blocks = await client.busy(calendar.href, range.from, range.to, calendar.mode === "titres" && !calendar.professionnel);
      return value(admin.rpc("sorties_remplacer_occupation", {
        p_id: calendar.id, p_revision: calendar.revision, p_commence: started, p_blocs: blocks,
      }));
    }));
    errors += results.filter((result) => result.status === "rejected" || !result.value).length;
  }
  return errors;
}

async function candidates(binding: Binding) {
  return (await value(admin.rpc("sorties_creneau_candidats", { p_espace: binding.espace_id })) || []) as Candidate[];
}

function verifySlot(info: Candidate, slot: Slot) {
  const local = swissDay(millis(slot.debut));
  const expected = preferredSlot(local, info.heure, info.duree);
  return expected && millis(expected.debut) === millis(slot.debut) && millis(expected.fin) === millis(slot.fin)
    && (info.date_debut ? local === info.date_debut : !info.date_limite || local <= info.date_limite);
}

async function mark(slot: Pending, statut: string, etag: string | null = slot.etag) {
  await value(creneaux().update({ statut, etag }).eq("id", slot.id).in("statut", ["prepare", "ecrit"]));
}

async function remove(client: ICloud, calendar: Calendar, slot: Pending) {
  if (!calendar.disponible || !calendar.modifiable || calendar.professionnel || calendar.nom !== "Eurêka"
    || !await client.canWrite(calendar.href)) return mark(slot, "conflit");
  if (slot.etag) return mark(slot, await client.remove(calendar.href, slot, slot.etag));
  // Une réponse réseau perdue après PUT ne permet pas de supposer que
  // l’événement n’existe pas. Ne cible que l’objet Eurêka identifié.
  const remote = await client.inspect(calendar.href, slot);
  if (!remote) return mark(slot, "retire");
  if (!remote.unchanged || !remote.etag) return mark(slot, "conflit");
  return mark(slot, await client.remove(calendar.href, slot, remote.etag));
}

async function deliver(client: ICloud, binding: Binding, slot: Pending, calendar: Calendar, active: Calendar[]) {
  const existing = await client.inspect(calendar.href, slot);
  if (existing) return mark(slot, existing.etag && existing.unchanged ? "ecrit" : "conflit", existing.etag);
  // Refait une lecture occupé seulement pour le créneau exact juste avant
  // l'écriture. Un agenda activé qui ne répond pas bloque la réservation.
  const parts = [];
  for (let i = 0; i < active.length; i += 4) {
    parts.push(...(await Promise.all(active.slice(i, i + 4)
      .map((item) => client.busy(item.href, slot.debut, slot.fin, false)))).flat());
  }
  if (parts.length) return mark(slot, "retire");
  const current = (await candidates(binding)).find((info) =>
    info.rappel_id === slot.rappel_id && info.calendrier_id === calendar.id && verifySlot(info, slot));
  if (!current || millis(slot.debut) <= Date.now()) return mark(slot, "retire");
  const currentActive = (await inventory(binding)).filter((item) => item.disponible && item.actif);
  if (currentActive.length !== active.length ||
    currentActive.some((item, i) => item.id !== active[i].id || item.revision !== active[i].revision)) return;
  if (!await client.canWrite(calendar.href)) return mark(slot, "conflit");
  const sent = await client.create(calendar.href, slot);
  if (sent.verify) {
    const remote = await client.inspect(calendar.href, slot);
    if (!remote) return;
    return mark(slot, remote.unchanged && remote.etag ? "ecrit" : "conflit", remote.etag);
  }
  return mark(slot, "ecrit", sent.etag);
}

async function provisional(client: ICloud, binding: Binding, calendars: Calendar[], range: ReturnType<typeof dates>, canWrite: boolean) {
  const list = () => creneaux().select("id,rappel_id,calendrier_id,debut,fin,statut,etag").eq("espace_id", binding.espace_id);
  const active = calendars.filter((calendar) => calendar.actif && calendar.disponible);
  const [possible, rows] = await Promise.all([
    candidates(binding), value(list().in("statut", ["prepare", "ecrit"]).order("cree_le").limit(100)),
  ]);
  let errors = 0;
  const byCalendar = new Map(calendars.map((item) => [item.id, item]));
  const eligibility = new Map(possible.map((item) => [item.rappel_id, item]));
  // Une annulation dépend seulement de la cible exacte, même si le miroir a échoué.
  const tasks = (rows || []) as Pending[];
  const invalid = (slot: Pending) => {
    const info = slot.rappel_id && eligibility.get(slot.rappel_id);
    return !info || info.calendrier_id !== slot.calendrier_id || !verifySlot(info, slot) || millis(slot.fin) <= Date.now();
  };
  const cleanup = tasks.filter(invalid).slice(0, 6);
  for (const slot of cleanup) {
    const calendar = byCalendar.get(slot.calendrier_id);
    if (!calendar) continue;
    try { await remove(client, calendar, slot); } catch { errors++; }
  }
  if (!canWrite || !active.length || active.length > 12) return errors;
  let processed = 0;
  for (const slot of tasks.filter((item) => item.statut === "prepare" && !invalid(item)).slice(0, 2)) {
    const calendar = byCalendar.get(slot.calendrier_id);
    if (!calendar) continue;
    try { await deliver(client, binding, slot, calendar, active); } catch { errors++; }
    processed++;
  }
  if (processed >= 2) return errors;
  const ids = possible.map((item) => item.rappel_id);
  const covered = new Set<string>();
  for (let i = 0; i < ids.length; i += 50) {
    const existing = await value(creneaux().select("rappel_id").eq("espace_id", binding.espace_id).in("rappel_id", ids.slice(i, i + 50)));
    for (const entry of existing || []) covered.add(entry.rappel_id);
  }
  for (const info of possible.filter((item) => !covered.has(item.rappel_id)
    && (!item.date_debut || item.date_debut >= range.day && item.date_debut <= swissDay(millis(range.to)))).slice(0, 30)) {
    if (processed >= 2) break;
    const calendar = byCalendar.get(info.calendrier_id);
    if (!calendar) continue;
    const start = info.date_debut || range.day;
    const end = info.date_debut || (info.date_limite && info.date_limite < dayPlus(range.day, 13)
      ? info.date_limite : dayPlus(range.day, 13));
    for (let day = start; day <= end; day = dayPlus(day, 1)) {
      const clock = preferredSlot(day, info.heure, info.duree);
      if (!clock || millis(clock.debut) <= Date.now() || millis(clock.fin) > millis(range.to)) continue;
      const id = await value(admin.rpc("sorties_preparer_creneau", { p_espace: binding.espace_id, p_rappel: info.rappel_id,
        p_calendrier: info.calendrier_id, p_debut: clock.debut, p_fin: clock.fin }));
      if (!id) continue;
      const slot = { id, ...clock, rappel_id: info.rappel_id, calendrier_id: calendar.id, statut: "prepare", etag: null };
      try { await deliver(client, binding, slot, calendar, active); } catch { errors++; }
      processed++;
      break;
    }
  }
  return errors;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !SITE.has(origin)) return response("null", { message: "Origine refusée." }, 403);
  if (req.method === "OPTIONS") return response(origin, null, 204);
  if (req.method !== "POST") return response(origin, { message: "Méthode refusée." }, 405);

  const configured = Deno.env.get("EUREKA_ICLOUD_CRON_SECRET") || "";
  const cron = !origin && configured.length >= 24 && equal(req.headers.get("x-icloud-cron") || "", configured);
  const action = cron ? "cron" : new URL(req.url).searchParams.get("action");
  let userId: string | undefined;
  if (!cron) {
    if (!["decouvrir", "synchroniser"].includes(action || "")) return response(origin, { message: "Action indisponible." }, 403);
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return response(origin, { message: "Connectez-vous." }, 401);
    const client = createClient(project, publicKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser(auth.slice(7));
    if (error || !data.user) return response(origin, { message: "Connectez-vous." }, 401);
    userId = data.user.id;
  }

  const lease = crypto.randomUUID();
  try {
    const binding = await value(liaison().select("espace_id,user_id").eq("singleton", true).maybeSingle()) as Binding | null;
    if (!binding || !cron && binding.user_id !== userId) return response(origin, { message: "Agenda indisponible." }, 403);
    const role = await value(admin.from("sorties_espace_membres").select("role")
      .eq("espace_id", binding.espace_id).eq("user_id", binding.user_id).maybeSingle());
    if (!role || !["owner", "membre"].includes(role.role)) return response(origin, { message: "Agenda indisponible." }, 403);
    const now = Date.now();
    const client = apple(binding, lease);
    const locked = await value(liaison().update({ bail: lease, bail_jusqua: new Date(now + 240_000).toISOString() })
      .eq("singleton", true).eq("espace_id", binding.espace_id).eq("user_id", binding.user_id)
      .or("bail_jusqua.is.null,bail_jusqua.lt." + new Date(now).toISOString()).select("singleton").maybeSingle());
    if (!locked) return response(origin, { en_cours: true }, 202);
    try {
      if (action === "decouvrir") {
        const found = await client.discover();
        await value(admin.rpc("sorties_reconcilier_calendriers", { p_user: binding.user_id, p_liste: found }));
        return response(origin, { calendriers: found.length });
      }
      const all = await inventory(binding);
      const active = all.filter((item) => item.actif && item.disponible);
      const range = dates(now);
      const errors = await mirror(client, active, range, action === "synchroniser");
      const slots = cron ? await provisional(client, binding, all, range, errors === 0) : 0;
      return response(origin, { lecture_incomplete: errors, creneaux_incomplets: slots });
    } finally {
      await liaison().update({ bail: null, bail_jusqua: null }).eq("singleton", true).eq("bail", lease);
    }
  } catch (error) {
    return response(origin, { message: error instanceof Setup ? error.message : "L’action iCloud n’a pas pu être terminée." }, 503);
  }
});
