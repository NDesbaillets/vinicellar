// Configuration Supabase (projet « vinicellar », région Zurich).
// La clé « publishable » est publique par conception : la sécurité repose sur les règles RLS (supabase/schema.sql).
// Ne JAMAIS mettre ici la clé « secret » ou « service_role ».
window.VC_CONFIG = {
  supabaseUrl: "https://ysdkbkujgbkrpjishttp.supabase.co",
  supabaseAnonKey: "sb_publishable_zh57QdYbqyr1dYqY-NsH7g_3hYb9rer",
  // Afficher l'onglet « Créer un compte » sur la page d'accueil.
  // Doit correspondre au réglage Supabase : Authentication > Sign In / Providers > « Allow new users to sign up ».
  openSignup: true
};
