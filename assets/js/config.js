// Configuration Supabase (projet « vinicellar », région Zurich).
// La clé « publishable » est publique par conception : la sécurité repose sur les règles RLS (supabase/schema.sql).
// Ne JAMAIS mettre ici la clé « secret » ou « service_role ».
window.VC_CONFIG = {
  supabaseUrl: "https://ysdkbkujgbkrpjishttp.supabase.co",
  supabaseAnonKey: "sb_publishable_zh57QdYbqyr1dYqY-NsH7g_3hYb9rer",
  // Inscription sur invitation : la page d'accueil propose « Demander une invitation », validée dans /app/admin.html.
  // Réglage Supabase correspondant : Authentication > Sign In / Providers > « Allow new users to sign up » désactivé.
  openSignup: false,
  // Activer uniquement après validation du schéma, du worker et des Edge Functions.
  studioEnabled: false
};
