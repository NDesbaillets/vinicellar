# Vinicellar

Site statique (GitHub Pages, vinicellar.ch) + Supabase (projet « vinicellar », Zurich). HTML + JS vanilla, aucun build. `main` est publié en production à chaque push : travailler sur une branche.

## ARÔMES V&N (/recettes/)

ARÔMES V&N : recueil personnel de recettes, hébergé sur vinicellar.ch/recettes/. Même domaine, même projet Supabase, même session d'auth que Vinicellar. Identité visuelle propre (direction « Le Livre » : Cormorant Garamond + EB Garamond, papier #F2EBDD, encre #2A221E, bordeaux #5C1A28, filet or #9A7B4F) ; ne jamais importer `assets/css/app.css` ni `core.js`. Aucun framework, aucun build : HTML + JS vanilla + supabase-js UMD, comme le reste du site.

### Rôle de la session principale (Opus) : coordinateur
- Tu planifies, découpes, revois. Tu n'écris toi-même que le code d'architecture (schéma SQL, contrats entre modules) et les arbitrages.
- Délègue chaque tâche de code à un sous-agent avec un brief autonome : fichiers concernés, contrat attendu, critère de fin vérifiable.
- `front-dev` (Sonnet) : pages et JS du dossier `recettes/`.
- `supabase-dev` (Sonnet) : migrations SQL, RLS, edge functions.
- `ui-reviewer` (Sonnet) : captures Playwright mobile + desktop, écarts au système visuel.
- `petites-taches` (Haiku) : renommages, textes, traductions, JSON de données (saisons), recherches dans le code.
- Lance en parallèle les tâches indépendantes. Relis chaque diff avant commit.

### Règles invariantes
- Tables préfixées `recipe_` dans `public`, RLS activée dès la création. Droits par appartenance au carnet et par rôle (`owner`, `member`, `reader`), sur le modèle de `supabase/sharing.sql` : fonctions `is_book_member(book)`, `is_book_editor(book)`, `is_book_owner(book)`.
- Jamais de clé secrète côté client. Les appels Apify, Gemini et Claude passent par des edge functions (secrets APIFY_TOKEN, GEMINI_API_KEY, ANTHROPIC_API_KEY) qui journalisent dans `public.ai_calls` (kind = 'recipe-*') et appliquent une limite quotidienne, comme `sommelier`. Import en arrière-plan, relances automatiques et modèle de repli pour Gemini.
- Ne jamais modifier les tables ou fonctions existantes de la cave sans le demander.
- Interface en français, dates JJ.MM.AAAA, unités métriques.
- Le cadrage fonctionnel fait foi : `docs/recettes/01-cadrage.md`. Toute décision qui s'en écarte se pose au propriétaire du projet.
