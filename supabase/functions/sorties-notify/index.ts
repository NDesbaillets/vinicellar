import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const SITE = "https://vinicellar.ch";
const provider = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
const encoder = new TextEncoder();
type Channel = "push" | "email";
type Outcome = "envoye" | "temporaire" | "indisponible";
type Delivery = Outcome | "annule";
type Entry = {
  id: string; user_id: string; espace_id: string; kind: "rappel" | "suivi" | "suggestion";
  canal: Channel; claimed_at: string; jour_local: string;
};
type Note = {
  idee_id: string; rappel_id: string | null; etape: 0 | 3 | 7 | 10 | null;
  confirme_actualite: boolean; ton: "neutre" | "direct_humour";
};

function same(a: string, b: string) {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return difference === 0;
}

function message(row: Entry, note: Note) {
  const query = new URLSearchParams({ espace: row.espace_id });
  const follow = row.kind === "suivi";
  query.set(follow ? "id" : "rappel", follow ? note.idee_id : note.rappel_id!);
  const url = (follow ? "/eureka/fiche.html?" : "/eureka/rappels.html?") + query;
  const title = "Eurêka";
  const base = { title, url, tag: "eureka-" + row.id };
  if (follow) return { ...base, body: "Une idée que vous suivez mérite un coup d’œil.", actions: [] };
  if (note.confirme_actualite) return { ...base, body: "Une idée est-elle toujours d’actualité ?", actions: [] };
  if (row.kind === "suggestion") {
    return {
      ...base, body: "Une idée pour ce week-end. Vous êtes libre ?",
      actions: [{ action: "disponible", title: "Oui" }, { action: "plus-tard", title: "Non" }],
    };
  }
  const direct = note.ton === "direct_humour";
  switch (note.etape) {
    case 3: return { ...base, body: direct ? "Le temps file. Où en est la réservation ?" : "Le délai de réservation approche.", actions: [] };
    case 7: return { ...base, body: "Une réservation attend votre décision.", actions: [] };
    case 10: return { ...base, body: "Dernier rappel. Réserver ou laisser passer ?", actions: [] };
    default: return { ...base, body: "C’est le moment de regarder la réservation.", actions: [{ action: "reserver", title: "Réserver" }] };
  }
}

function validEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password && !url.hash && provider.test(url.hostname);
  } catch { return false; }
}

async function push(row: Entry, content: ReturnType<typeof message>): Promise<Delivery> {
  if (!vapid) return "indisponible";
  const { data, error } = await admin.from("sorties_push_subscriptions")
    .select("id,endpoint,p256dh,auth").eq("user_id", row.user_id).order("created_at", { ascending: false }).limit(12);
  if (error) return "temporaire";
  if (row.kind === "suivi" && data?.length) {
    const consent = await admin.rpc("sorties_notification_prete", { p_id: row.id });
    if (consent.error) return "temporaire";
    if (!consent.data) return "annule";
  }
  const results = await Promise.all((data ?? []).map(async (s): Promise<Outcome> => {
    if (!validEndpoint(s.endpoint)) return "indisponible";
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(content), {
          vapidDetails: vapid!, TTL: 3600, timeout: 8000, topic: row.id.replaceAll("-", ""),
        });
      return "envoye";
    } catch (error) {
      const code = (error as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await admin.from("sorties_push_subscriptions").delete().eq("id", s.id).eq("user_id", row.user_id);
        return "indisponible";
      }
      return code && code < 500 && code !== 429 ? "indisponible" : "temporaire";
    }
  }));
  return results.includes("envoye") ? "envoye" : results.includes("temporaire") ? "temporaire" : "indisponible";
}

async function email(row: Entry, content: ReturnType<typeof message>): Promise<Outcome> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EUREKA_EMAIL_FROM") || Deno.env.get("WATCH_EMAIL_FROM");
  if (!key || !from) return "indisponible";
  const { data, error } = await admin.auth.admin.getUserById(row.user_id);
  if (error) return error.status === 404 ? "indisponible" : "temporaire";
  if (!data.user?.email || !data.user.email_confirmed_at) return "indisponible";
  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": row.id },
      body: JSON.stringify({ from, to: [data.user.email], subject: "Rappel Eurêka", text: content.body + "\n\n" + SITE + content.url }),
    });
    await result.body?.cancel();
    return result.ok ? "envoye" : result.status >= 500 || result.status === 429 ? "temporaire" : "indisponible";
  } catch {
    return "temporaire";
  }
}

const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const subject = Deno.env.get("VAPID_SUBJECT");
const vapid = publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;

async function deliver(row: Entry) {
  const finish = async (state: Delivery, channel: Channel | null = null) => {
    const { error } = await admin.rpc("sorties_clore_notification", {
      p_id: row.id, p_bail: row.claimed_at, p_etat: state, p_canal: channel,
    });
    return error ? "temporaire" : state;
  };
  const read = () => admin.rpc("sorties_notification_prete", { p_id: row.id });
  const { data, error } = await read();
  if (error) return finish("temporaire");
  if (!data) return finish("annule");
  const note = data as Note;
  const content = message(row, note);
  const transport = { push, email };
  let channel: Channel = row.kind === "suivi" ? "push" : row.canal;
  let state = await transport[channel](row, content);
  // Une réponse temporaire peut cacher un envoi déjà accepté. Dans ce cas,
  // on réessaie le même canal avec la même clé plutôt que d'en changer.
  if (state === "indisponible" && row.kind === "rappel" && !note.confirme_actualite
    && (note.etape === 7 || note.etape === 10)) {
    const again = await read();
    if (again.error) return finish("temporaire");
    if (!again.data) return finish("annule");
    channel = channel === "push" ? "email" : "push";
    state = await transport[channel](row, content);
  }
  return finish(state, channel);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method" }, { status: 405 });
  const secret = Deno.env.get("EUREKA_NOTIFY_SECRET") ?? "";
  if (secret.length < 24 || !same(req.headers.get("x-notify-secret") ?? "", secret)) {
    return Response.json({ error: "authorization" }, { status: 401 });
  }
  const { data, error } = await admin.rpc("sorties_reclamer_notifications", { p_limite: 8 });
  if (error) return Response.json({ error: "claim" }, { status: 500 });
  const counts: Record<string, number> = {};
  const rows = (data ?? []) as Entry[];
  for (let start = 0; start < rows.length; start += 4) {
    const states = await Promise.allSettled(rows.slice(start, start + 4).map(deliver));
    for (const result of states) {
      const state = result.status === "fulfilled" ? result.value : "temporaire";
      counts[state] = (counts[state] || 0) + 1;
    }
  }
  return Response.json(counts);
});
