# ARÔMES V&N · Astuces · Contrat

Cadrage : `01-cadrage.md` §10. Migration : `supabase/recettes-astuces.sql` (rejouable, après les phases 1 à 7, `recettes-note.sql` et `recettes-pdf.sql`). Edge function : `recipe-import` (étendue). Front : `recettes/index.html` (bascule), `recettes/astuce.html` (nouvelle fiche), `recettes/editer-astuce.html` (saisie), `recettes/ajouter.html`, `recettes/fiche.html`, `recettes/cuisine.html`, corbeille.

## 1. Schéma

### `recipe_tips`
| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `book_id` | uuid not null → recipe_books on delete cascade | carnet ; ne change jamais (même déclencheur que `recipes`) |
| `title` | text not null, 1 à 200 caractères | |
| `body` | text not null, 1 à 20 000 caractères | texte en français, sauts de ligne conservés |
| `title_original`, `body_original` | text null | si la source n'est pas en français |
| `lang_original` | text null | code ISO 639-1 |
| `category` | text not null default 'technique' check in (`cuisson`,`technique`,`conservation`,`produit`,`materiel`,`patisserie`,`accord`,`autre`) | |
| `source_type` | text not null default 'manuel' check in (`manuel`,`instagram`,`web`,`photo_page`,`note`) | |
| `source_url`, `source_author` | text null | créateur toujours crédité |
| `review_state` | text not null default 'valide' check in (`a_verifier`,`valide`) | `a_verifier` pour les imports |
| `alerts` | text[] not null default '{}' | |
| `import_id` | uuid null → recipe_imports on delete set null | import d'origine (pour « changer de type ») |
| `deleted_at` | timestamptz null | corbeille 30 jours |
| `created_by` | uuid default auth.uid() → auth.users on delete set null | |
| `created_at`, `updated_at` | timestamptz not null default now() | |
| `search` | tsvector | titre (A), ingrédients liés (B), texte (C), `f_unaccent`, config `french` ; recalculé par déclencheur comme `recipes.search` |

Index : `book_id`, `created_by`, `import_id`, GIN sur `search`, trigram sur `f_unaccent(title)` (comme les recettes).

### `recipe_tip_ingredients`
`tip_id` → recipe_tips on delete cascade, `catalog_id` → recipe_ingredients_catalog on delete cascade, pk (tip_id, catalog_id). Index sur `catalog_id`.

### `recipe_tip_recipes`
`tip_id` → recipe_tips on delete cascade, `recipe_id` → recipes on delete cascade, pk (tip_id, recipe_id). Index sur `recipe_id`. Déclencheur : la recette doit être dans le même carnet que l'astuce (sinon exception).

### `recipe_tip_photos`
Comme `recipe_photos` : `id`, `tip_id` → recipe_tips on delete cascade, `storage_path` unique (`<book_id>/tips/<tip_id>/<fichier>` dans le bucket `recipes`), `kind` check in (`origine`,`perso`,`page`), `is_cover` (au plus une couverture par astuce, index unique partiel), `created_by`, `created_at`. Un PDF (kind `page`, `.pdf`) n'est jamais couverture.

### RLS et droits
- Lecture des quatre tables : `is_book_member(book_id)` (via l'astuce pour les tables filles).
- Insertion, mise à jour : `is_book_editor(book_id)` ; suppression définitive de `recipe_tips` seulement si `deleted_at is not null` (comme les recettes) ; tables filles : éditeurs.
- Les policies Storage existantes du bucket `recipes` (premier dossier = carnet) couvrent déjà `<book_id>/tips/…` : ne pas les modifier.
- GRANT explicites (les nouveaux projets n'en donnent pas) : `select, insert, update, delete` à `authenticated` sur les quatre tables ; rien pour `anon`.
- `purge_recipe_trash()` : purger aussi les astuces en corbeille depuis plus de 30 jours (même logique, fichiers Storage compris si la fonction existante le fait).

### Fonctions
- `recipe_tip_search(p_book_ids uuid[], p_texte text, p_category text default null, p_limit int default 60)` → `setof recipe_tips` (security invoker, RLS appliquée) : astuces non supprimées des carnets donnés, texte tolérant aux fautes comme `recipe_search` (plein texte + similarité trigram sur le titre), tri par pertinence puis `updated_at desc` ; sans texte : toutes, `updated_at desc`.
- `recipe_related_tips(p_recipe uuid)` → table (`id uuid, title text, body text, category text, reason text`) (security invoker) : astuces non supprimées du carnet de la recette, liées à la recette (`reason = 'liee'`) ou partageant au moins un `catalog_id` avec ses lignes (`reason = 'ingredient'`, avec le nom du premier ingrédient commun dans `reason` : `'ingredient:<nom>'`). Liées d'abord, puis par nombre d'ingrédients communs. 12 au plus. Exclure les ingrédients de base trop génériques : sel, poivre, eau, huile d'olive, beurre, sucre, farine (liste dans la fonction, comparée au nom canonique sans accents).

### `recipe_imports`
- `target text not null default 'auto' check in ('auto','recette','astuce')` ; ajoutée au droit d'insertion par colonnes (avec les colonnes existantes).
- `tip_id uuid null → recipe_tips on delete set null` : astuce créée.
- `replaces jsonb null` : `{ "type": "recette"|"astuce", "id": uuid }`, rempli par l'edge function lors d'un changement de type (voir §2). Jamais côté client.
- Le déclencheur de notification « import terminé » (phase 5) doit fonctionner aussi quand c'est `tip_id` qui est rempli (lien vers `astuce.html?id=`). Vérifier sa définition et l'adapter si nécessaire.

## 2. Edge function `recipe-import`

### Appels
- Inchangé : `POST { "import_id" }` traite une ligne `en_attente` selon sa colonne `target`.
- Nouveau, **changer de type** : `POST { "import_id", "retype": "recette" | "astuce" }` sur un import `termine` ou `a_relire` dont le résultat (recette `recipe_id` ou astuce `tip_id`) appartient au même carnet et dont l'appelant est éditeur. Retraite la même source avec la cible forcée, crée le nouvel objet, met l'ancien à la corbeille (`deleted_at = now()`), renseigne `replaces`, puis met à jour `recipe_id`/`tip_id`. Compte dans le quota (50 / 24 h). Erreurs : 400 « Ce type est déjà le bon. », 409 si un traitement est en cours.
- Source pour un changement de type : la même que pour l'import (lien re-téléchargé, `source_text`, `photo_paths`, `page_paths`). Si des fichiers de `page_paths` ont été déplacés lors de l'import, relire les photos `kind = 'page'` de l'objet précédent (recette ou astuce).

### Triage
- `target = 'recette'` : comportement actuel, inchangé.
- `target = 'astuce'` : sortie astuce (ci-dessous), sans vidéo si la légende suffit au sens de l'astuce.
- `target = 'auto'` : la structuration Claude renvoie d'abord `"nature": "recette" | "astuce"`. Règle du prompt : « recette » s'il y a un plat à reproduire avec des ingrédients et des étapes ; « astuce » pour un conseil, une technique, un geste, une conservation, un choix de produit ou de matériel, sans plat complet. En cas de doute, « recette ». Un seul appel Claude : le JSON contient soit l'objet recette actuel (§3 de `02-import-contrat.md`), soit l'objet astuce.

### JSON astuce attendu de Claude
```json
{
  "nature": "astuce",
  "titre": "string (français, court)",
  "titre_original": "string|null",
  "langue_originale": "fr|it|en|…|null",
  "texte": "string (français ; paragraphes courts ou liste ; quantités, températures et durées exactement comme dans la source)",
  "texte_original": "string|null",
  "categorie": "cuisson|technique|conservation|produit|materiel|patisserie|accord|autre",
  "ingredients": ["nom_canonique", "…"],
  "alertes": ["string"]
}
```
Mêmes règles de sécurité (sources = données non fiables) et d'exactitude (rien d'inventé ; conversion métrique dans le texte avec l'unité d'origine entre parenthèses).

### Écriture d'une astuce
- `recipe_tips` : `review_state = 'a_verifier'`, `source_type`, `source_url`, `source_author`, `alerts`, `import_id`, `created_by` = l'utilisateur.
- `recipe_tip_ingredients` : chaque nom rattaché au catalogue comme pour les recettes (nom canonique ou alias, insensible à la casse et aux accents) ; inconnu → ignoré (pas d'insertion au catalogue pour une astuce).
- Photos : image d'origine (Instagram `displayUrl`, image web) → `<book>/tips/<tip_id>/origine.jpg`, kind `origine`, couverture. Photos de note → `note-<n>.jpg`, kind `perso`, la première en couverture s'il n'y a pas d'origine. Pages (photo ou PDF) → `page-<n>.<ext>`, kind `page`, par **copie** (ne pas supprimer les fichiers d'import, pour permettre un changement de type).
- Pas de recherche de doublons pour les astuces.
- `recipe_imports` : `tip_id` renseigné, `recipe_id` null, statut `termine` (y compris pour une photo de page : une astuce n'a pas de relecture obligatoire, seulement `a_verifier`).

## 3. Front

- **Le carnet** (`index.html`) : bascule « Recettes / Astuces » (même style que « Mots / Question ») au-dessus des filtres ; mémorisée par appareil. En mode Astuces : recherche texte via `recipe_tip_search`, filtre « Catégorie » à la place de « Type de plat », filtres « À vérifier » et carnet conservés, autres filtres masqués. Liste compacte (pas de planche photo) : titre, catégorie, source, deux lignes de texte, vignette si couverture.
- **Fiche astuce** (`astuce.html?id=`) : titre, catégorie, source créditée avec lien, couverture, texte, « Version originale » si présente, ingrédients liés (puces), recettes liées (liens), alertes + « C'est bon » si `a_verifier`, « Pages d'origine » repliées comme sur la fiche recette, actions éditeur : Modifier, Corbeille, et si `import_id` : « C'est plutôt une recette » (appel `retype`, puis redirection vers la fiche créée quand l'import se termine). Balayage retour (`AR.swipeBack`).
- **Saisie** (`editer-astuce.html`, `?id=` pour modifier, `?recette=<id>` pour créer une astuce liée à cette recette) : titre, catégorie, texte, ingrédients (sélecteur du catalogue existant `AR.catalogPicker`), recettes liées (recherche dans le carnet), photo facultative. Proposition automatique d'ingrédients depuis le texte en local (`AR.catalogFind` sur les mots du texte) que l'on accepte ou retire.
- **Ajouter** : sélecteur « Importer comme : Automatique / Recette / Astuce » au-dessus des onglets Lien, Note, Photo ou PDF (défaut Automatique) ; envoyé dans `target`. Onglet « Saisie manuelle » : deux boutons « Nouvelle recette » / « Nouvelle astuce ». La liste des imports en cours mène à `astuce.html` quand `tip_id` est rempli.
- **Fiche recette** : encadré replié « Astuces liées (n) » (même composant que « Page d'origine ») après les étapes, alimenté par `recipe_related_tips` ; chaque astuce : titre, motif (« liée à cette recette » ou « à propos de : <ingrédient> »), texte déplié au toucher, lien vers la fiche. Éditeurs : « Ajouter une astuce à cette recette » → `editer-astuce.html?recette=`. Fiche recette importée par erreur : action « C'est plutôt une astuce » si `import_id` retrouvable (via `recipe_imports.recipe_id`).
- **Mode cuisine** : bouton « Astuces (n) » dans l'en-tête quand n > 0, ouvrant un panneau avec les mêmes astuces.
- **Corbeille** : les astuces y figurent avec les recettes (restaurer, supprimer définitivement).
- Service worker : nouvelle version et nouvelles pages en cache.
