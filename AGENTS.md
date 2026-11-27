# AGENTS.md

Dépôt : vinicellar.ch (site statique GitHub Pages + Supabase projet « vinicellar »). HTML et JS vanilla, aucun build, aucun framework.

## Chantier en cours : Eurêka, Vivcolas ! (`/eureka/`)

Lire d'abord `docs/eureka/01-cadrage.md` : il fait foi. Toute décision qui s'en écarte se pose au propriétaire (Nicolas Desbaillets). Maquettes de référence : `docs/eureka/maquettes/`.

## Règles invariantes

- `main` est publié en production à chaque push. Travailler sur la branche `eureka`, proposer une pull request, ne jamais pousser sur `main`.
- Tables préfixées `sorties_` dans `public`, RLS activée dès la création, droits par appartenance à un espace (modèle : `supabase/sharing.sql`). Jamais de politique « tout utilisateur connecté ».
- Ne jamais modifier les tables, fonctions ou politiques existantes (cave, ARÔMES V&N, watch) sans l'accord du propriétaire.
- Ne jamais appliquer de migration à la base de production. Produire le fichier SQL (`supabase/eureka.sql`) et s'arrêter : le propriétaire relit et applique.
- Aucune clé secrète côté client, ni dans le dépôt (il est public), ni dans un prompt. Appels IA, Apify et CalDAV passent par des edge functions avec secrets Supabase, journalisés dans `public.ai_calls` (kind `sorties-*`) avec plafond mensuel par espace.
- Interface en français, dates JJ.MM.AAAA, unités métriques, CHF.
- Eurêka a sa propre identité visuelle (Atelier, voir cadrage section 10). Ne pas importer `assets/css/app.css`, `core.js` ni les feuilles de `/recettes/`.
- Modèles à copier : `/recettes/` (manifeste, service worker à portée propre, structure de pages), `supabase/functions/recipe-import` (photos, reels, Apify), `supabase/functions/recipe-notify` (web push VAPID depuis une table d'attente).
- Données personnelles : aucun titre d'agenda n'est synchronisé sans activation explicite du calendrier par l'utilisateur ; par défaut, plages « occupé » seulement.

## Méthode

- Petits commits, un sujet par commit, messages en français.
- Chaque page : fonctionne à 390 px de large (mobile d'abord), cibles tactiles d'au moins 44 px, contraste de texte d'au moins 4,5:1.
- Avant de déclarer une étape terminée : tests existants du dépôt qui concernent le périmètre modifié, et vérification visuelle mobile des pages créées.
- Si une information manque (secret, décision de produit, règle d'accès ambiguë) : s'arrêter et poser la question, ne pas deviner.
