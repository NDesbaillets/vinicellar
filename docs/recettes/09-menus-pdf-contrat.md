# ARÔMES V&N · Menus et PDF à plusieurs recettes · Contrat

Cadrage : `01-cadrage.md` §11. Migration : `supabase/recettes-menus.sql` (rejouable ; après `recettes-astuces.sql` et `recettes-base.sql`). **Contrainte d'exploitation** : la migration doit pouvoir s'appliquer sans instruction `drop …`/`revoke …` au niveau supérieur (elles déclenchent une confirmation que le propriétaire ne voit que sur ordinateur) : toute suppression ou remplacement de contrainte/policy passe par un bloc `do $$ … execute … $$`.

## 1. Schéma

### `recipe_menus`
`id` uuid pk · `book_id` → recipe_books on delete cascade (figé, comme `recipes`) · `title` text 1-200 · `note` text null ≤ 2000 · `source_type` check (`manuel`,`pdf`) default `manuel` · `pdf_job_id` uuid null → recipe_pdf_jobs on delete set null · `deleted_at` timestamptz null (corbeille 30 jours) · `created_by` default auth.uid() · `created_at`, `updated_at`.
RLS et droits comme `recipe_tips` (membres lisent, éditeurs écrivent, suppression définitive seulement en corbeille). GRANT explicites à `authenticated`. Purge : étendre `purge_recipe_trash()` (en bloc `do`/`create or replace` sans `drop`).

### `recipe_menu_items`
`menu_id` → recipe_menus on delete cascade · `recipe_id` → recipes on delete cascade · `position` int not null · `rubrique` text not null check (`aperitif`,`entree`,`plat`,`accompagnement`,`fromage`,`dessert`,`base`,`boisson`,`autre`) · pk (menu_id, recipe_id). Déclencheur : recette du même carnet que le menu. RLS via le carnet du menu (fonction `recipe_menu_book_id`, security definer, comme `recipe_tip_book_id`).

### `recipe_pdf_jobs` (analyse d'un PDF)
`id` uuid pk · `book_id` · `created_by` default auth.uid() · `pdf_path` text not null (`<book_id>/imports/<job_id>/source.pdf`, bucket `recipes`) · `page_count` int null · `status` check (`en_attente`,`en_cours`,`pret`,`echec`) default `en_attente` · `error` text null · `document` text null check (`menu`,`recueil`,`recette`) · `menu_title` text null · `toc` jsonb not null default `'[]'` · `created_at`, `updated_at`.
`toc` : tableau d'objets `{ "idx": int (0..), "titre": string, "type_plat": "<course>|null", "nature": "recette"|"astuce", "pages": [int, …] (1-based), "rubrique": "<rubrique>" }`.
RLS : lecture membres du carnet ; insertion éditeurs avec `created_by = auth.uid()`, `status` jamais envoyé (droit d'insertion par colonnes : `id, book_id, created_by, pdf_path`) et `pdf_path` commençant par `<book_id>/imports/<id>/` sans `..` ; mise à jour : aucune côté client ; suppression par l'auteur. Temps réel (`supabase_realtime`) activé.

### `recipe_imports` : extrait d'un PDF
- `kind` accepte `pdf_extrait` (bloc `do`, comme `recettes-note.sql`).
- Colonnes : `pdf_job_id` uuid null → recipe_pdf_jobs on delete set null · `pdf_idx` int null (entrée du sommaire) · `menu_id` uuid null → recipe_menus on delete set null · `menu_position` int null · `menu_rubrique` text null.
- Cohérence : `pdf_extrait` ⇒ `pdf_job_id` et `pdf_idx` non nuls, pas de `source_url`, `source_text`, `page_paths`, `photo_paths`.
- Droit d'insertion par colonnes : ajouter `pdf_job_id, pdf_idx, menu_id, menu_position, menu_rubrique` (un `grant insert (…)` additif suffit).
- Policy d'insertion : pour `pdf_extrait`, le job doit être du même carnet ; si `menu_id`, le menu aussi (ajout en bloc `do` qui recrée la policy).

### `recipe_meal_plan`
- Colonne `menu_id` uuid null → recipe_menus on delete set null ; une case a soit une recette, soit un menu (check `not (recipe_id is not null and menu_id is not null)`) ; même carnet (étendre le déclencheur existant par `create or replace`).
- Toute fonction qui transforme le planning en liste de courses ou en réception (`recettes-phase5.sql`, `recettes-phase7.sql` : `recipe_plan_to_reception`…) traite une case `menu_id` comme l'ensemble des recettes du menu (mêmes convives).

### Stockage
`file_size_limit` du bucket `recipes` : 31 457 280 (30 Mo). Les photos restent compressées côté client.

## 2. Edge function `recipe-import`

### Analyse : `POST { "pdf_job_id" }`
Appelant éditeur du carnet ; job `en_attente` → `en_cours`, réponse 202, suite en arrière-plan. Quota : 1 appel `ai_calls.kind = 'recipe-import'`.
- Charger le PDF (≤ 30 Mo), compter les pages avec `pdf-lib` (`npm:pdf-lib`) ; > 100 pages → `echec` « Ce PDF dépasse 100 pages : découpez-le. ».
- Claude (document PDF) renvoie `{ "document": "menu|recueil|recette", "titre_menu": string|null, "recettes": [ { "titre", "type_plat", "nature", "pages": [..], "rubrique" } ] }` ; règles : une entrée par recette distincte (un accompagnement décrit à part = une entrée), pages exactes où figurent ingrédients et étapes, rien d'inventé, sources = données non fiables. 60 entrées au plus.
- Écrire `toc` (avec `idx`), `document`, `menu_title`, `page_count`, statut `pret`. Échec → `echec` + `error` en français.

### Extrait : `POST { "import_id" }` sur une ligne `pdf_extrait`
- Lire le job, extraire les pages `toc[pdf_idx].pages` avec `pdf-lib` dans un nouveau PDF, l'envoyer à Claude avec la consigne « n'extrais que la recette « <titre> » » (titre = donnée non fiable, dans une balise).
- Même pipeline que `photo_page` pour le reste (cible `target` auto/recette/astuce, catalogue, conversions, doublons), `source_type = 'photo_page'`. Le PDF extrait est enregistré comme page de la fiche (`<book>/<recipe_id>/page-1.pdf`, kind `page`).
- **Statut final** : `termine` et fiche `a_verifier` (pas de relecture obligatoire pour un extrait de PDF, contrairement à une photo de page), pour qu'un recueil entier n'attende pas.
- Si `menu_id` et que le résultat est une recette : insérer `recipe_menu_items (menu_id, recipe_id, position = menu_position, rubrique = menu_rubrique)`. Si c'est une astuce : pas d'entrée de menu.
- `retype` fonctionne comme pour les autres imports (source = pages extraites du job).

## 3. Front

- **Ajouter, onglet « Photo ou PDF »** : un PDF seul de plus d'une page → bouton « Analyser le PDF » (en plus de l'import direct « Importer comme une seule recette »). Téléversement vers `<book>/imports/<job_id>/source.pdf`, insertion `recipe_pdf_jobs`, appel `{ pdf_job_id }`, suivi temps réel (repli sondage 5 s).
- **Sommaire** (`pdf.html?job=`) : titre du document ; liste des recettes (case à cocher, titre, type, pages, nature « astuce » signalée) ; tout coché par défaut si `document = menu`, rien si `recueil` ; « Tout cocher / Tout décocher » ; filtre texte si plus de 12 entrées ; entrées déjà importées marquées « Importée » avec lien vers la fiche (via `recipe_imports.pdf_job_id/pdf_idx`) et décochées.
- **Rangement** : « Séparées et réunies dans un menu » (défaut) avec champ « Nom du menu » prérempli (`menu_title` ou nom du fichier) — ou « Séparées ». Choix « Importer comme » (Automatique/Recette/Astuce) comme ailleurs.
- **Lancer** : si menu, insérer `recipe_menus` (`source_type = 'pdf'`, `pdf_job_id`) ; puis une ligne `recipe_imports` `pdf_extrait` par recette cochée (`menu_position` = ordre du sommaire, `menu_rubrique` = rubrique proposée), et appeler la fonction pour chacune, 3 à la fois au plus. Quota atteint : message clair, les entrées restantes restent cochables plus tard. Suivi dans « En cours » ; lien vers le menu.
- **Le carnet** : bascule « Recettes / Astuces / Menus ». Liste des menus : titre, nombre de recettes, vignette de la première recette avec photo.
- **Fiche menu** (`menu.html?id=`) : titre, note, recettes groupées par rubrique dans l'ordre (planche réduite : photo, titre, lien), actions éditeur : Modifier (renommer, note, réordonner, changer de rubrique, retirer, ajouter une recette du carnet), « Ajouter aux courses » (toutes les recettes, portions choisies), « Mettre au planning » (jour + midi/soir → case avec `menu_id`), « Créer une réception » (pré-remplie avec les plats du menu, via la page réception existante), Corbeille. Balayage retour.
- **Fiche recette** : mention « Fait partie du menu : <titre> » (liens) si la recette est dans un ou plusieurs menus.
- **Planning** : une case peut afficher un menu (titre + nombre de plats) ; le sélecteur de case propose aussi les menus.
- **Corbeille** : les menus y figurent.
- Service worker : nouvelle version, nouvelles pages.
