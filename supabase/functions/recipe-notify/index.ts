// ARÔMES V&N · envoi des notifications web push en attente (table recipe_notifications_outbox).
// Appelée uniquement par le serveur : webhook de base de données (insert sur l'outbox) ou pg_cron. Jamais par un
// utilisateur : aucun CORS, aucun JWT utilisateur. Authentification (l'une ou l'autre) :
//   - en-tête « x-notify-secret » égal au secret NOTIFY_SECRET (recommandé), ou
//   - « Authorization: Bearer <service_role>» égal à la clé SUPABASE_SERVICE_ROLE_KEY de la fonction.
// Déploiement : `supabase functions deploy recipe-notify --no-verify-jwt` (le contrôle ci-dessous remplace celui du
// JWT : le webhook ne porte pas de JWT utilisateur). Secrets : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
// NOTIFY_SECRET. Voir docs/recettes/05-organiser-contrat.md.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const SITE = "https://vinicellar.ch";
const BATCH = 50;
const TTL_SECONDS = 24 * 3600;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Comparaison à durée constante (évite de deviner un secret par le temps de réponse).
function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

function authorized(req: Request): boolean {
  const secret = Deno.env.get("NOTIFY_SECRET") ?? "";
  const given = req.headers.get("x-notify-secret") ?? "";
  if (secret.length >= 16 && given && same(given, secret)) return true;
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return !!service && !!bearer && same(bearer, service);
}

// Textes affichés sur l'écran verrouillé : français, sans donnée sensible (titre de recette et nom de carnet
// seulement, nettoyés et tronqués ; jamais d'e-mail, de note ni de quantité).
const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fiche = (id: unknown) => (typeof id === "string" && UUID.test(id) ? `/recettes/fiche.html?id=${id}` : "/recettes/");

type Row = { id: number; user_id: string; kind: string; payload: Record<string, unknown> };

function message(r: Row): { title: string; body: string; url: string; tag: string } {
  const p = r.payload ?? {};
  const book = clean(p.book_name, 80);
  if (r.kind === "import_termine") {
    const relire = p.status === "a_relire";
    return {
      title: relire ? "Import à relire" : "Import terminé",
      body: relire ? "Une fiche attend votre relecture avant d'entrer au carnet." : "Votre recette est prête dans le carnet.",
      url: fiche(p.recipe_id), tag: `import-${clean(p.import_id, 40)}`,
    };
  }
  if (r.kind === "recette_ajoutee") {
    const title = clean(p.title, 100);
    return {
      title: "Nouvelle recette",
      body: title ? `« ${title} » a été ajoutée${book ? ` au carnet « ${book} »` : " au carnet"}.` : "Une recette a été ajoutée au carnet.",
      url: fiche(p.recipe_id), tag: `recette-${clean(p.recipe_id, 40)}`,
    };
  }
  return {
    title: "Invitation à un carnet",
    body: book ? `Vous êtes invité(e) au carnet « ${book} ».` : "Vous êtes invité(e) à rejoindre un carnet.",
    url: "/recettes/carnets.html", tag: `invitation-${clean(p.invite_id, 40)}`,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  if (!authorized(req)) return json(401, { error: "auth" });

  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!pub || !priv || !subject) return json(503, { error: "not_configured" });
  webpush.setVapidDetails(subject, pub, priv);

  // Le corps du webhook (type, record) n'est volontairement pas utilisé : on traite tout ce qui est en attente,
  // ce qui rend le webhook et le cron interchangeables et rattrape les envois échoués.
  const { data: rows, error } = await admin.rpc("recipe_outbox_claim", { p_limit: BATCH });
  if (error) { console.error("recipe-notify: claim", error.message); return json(500, { error: "claim" }); }

  const stats = { claimed: rows?.length ?? 0, sent: 0, no_subscription: 0, failed: 0, expired_removed: 0 };
  for (const r of (rows ?? []) as Row[]) {
    const { data: subs, error: se } = await admin.from("recipe_push_subscriptions")
      .select("id, endpoint, p256dh, auth").eq("user_id", r.user_id);
    if (se) { stats.failed++; await admin.from("recipe_notifications_outbox").update({ last_error: "lecture des abonnements" }).eq("id", r.id); continue; }
    if (!subs?.length) {
      // Aucun appareil abonné : rien à envoyer, la notification est close.
      stats.no_subscription++;
      await admin.from("recipe_notifications_outbox").update({ sent_at: new Date().toISOString(), last_error: "aucun abonnement" }).eq("id", r.id);
      continue;
    }
    const m = message(r);
    const body = JSON.stringify({ ...m, kind: r.kind, icon: `${SITE}/recettes/assets/logo-aromes-vn-fond.svg` });
    let ok = 0, transient = 0, lastErr = "";
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: TTL_SECONDS, urgency: "normal" });
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          // Abonnement expiré ou révoqué : on le supprime.
          await admin.from("recipe_push_subscriptions").delete().eq("id", s.id);
          stats.expired_removed++;
        } else {
          transient++;
          lastErr = `push ${code ?? "réseau"}`;
          console.error("recipe-notify: envoi", code ?? (e as Error).message);
        }
      }
    }));
    if (ok > 0 || transient === 0) {
      // Au moins un appareil atteint, ou tous les abonnements étaient expirés : terminé.
      stats.sent += ok > 0 ? 1 : 0;
      await admin.from("recipe_notifications_outbox").update({ sent_at: new Date().toISOString(), last_error: null }).eq("id", r.id);
    } else {
      // Échec temporaire sur tous les appareils : sent_at reste vide, nouvelle tentative (5 au plus) au prochain passage.
      stats.failed++;
      await admin.from("recipe_notifications_outbox").update({ last_error: lastErr }).eq("id", r.id);
    }
  }
  return json(200, stats);
});
