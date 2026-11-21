# ARÔMES V&N · Phase 2 · Contrat de l'import

Contrat entre le back-end (`supabase/recettes-phase2.sql`, edge function `recipe-import`) et le front (`recettes/ajouter.html`, `recettes/fiche.html`). Cadrage : `01-cadrage.md` §2. Pipeline Instagram validé par le test du 19.11.2026 (10 reels).

## 1. Table `recipe_imports` (suivi des imports en arrière-plan)

| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid pk | |
| `book_id` | uuid → recipe_books | carnet de destination |
| `created_by` | uuid, défaut auth.uid() | |
| `kind` | text check `instagram`,`web`,`photo_page` | |
| `source_url` | text null | lien (instagram, web) |
| `page_paths` | text[] | photos de page dans le bucket `recipes` (`<book_id>/imports/<import_id>/<n>.jpg`) |
| `status` | text check `en_attente`,`en_cours`,`a_relire`,`termine`,`echec` | |
| `step` | text null | étape lisible en français (« Récupération du reel », « Lecture de la vidéo », « Rédaction de la fiche ») |
| `error` | text null | message français si `echec` |
| `recipe_id` | uuid null → recipes on delete set null | fiche créée |
| `duplicate_of` | uuid null → recipes on delete set null | recette existante jugée très proche |
| `video_path` | text null | vidéo stockée (bucket `recipe-videos`), supprimée après 30 jours |
| `attempts` | int défaut 0 | |
| `created_at`, `updated_at` | timestamptz | |

RLS : lecture par les membres du carnet ; insertion par les éditeurs (`is_book_editor`) avec `created_by = auth.uid()` ; mise à jour et suppression : aucune côté client (l'edge function écrit avec service_role), sauf suppression par son auteur quand `status in ('termine','echec')`. Activer la réplication temps réel (`supabase_realtime`) sur cette table pour que le front suive l'avancement.

Bucket privé `recipe-videos` (aucune policy client ; service_role seulement). Fonction `purge_recipe_videos()` listant les `video_path` de plus de 30 jours (la suppression des fichiers se fait par l'API Storage, appelée par l'edge function au début de chaque import : nettoyage opportuniste).

## 2. Edge function `recipe-import`

`POST /functions/v1/recipe-import`, `Authorization: Bearer <jwt>`, corps :

```json
{ "import_id": "uuid" }
```

Le front crée d'abord la ligne `recipe_imports` (status `en_attente`, et pour `photo_page` téléverse les photos de page avant), puis appelle la fonction. La fonction vérifie que l'appelant est éditeur du carnet, applique la limite (50 imports par personne et par 24 h, `ai_calls.kind = 'recipe-import'`), passe le statut à `en_cours`, répond immédiatement `202 { "status": "en_cours" }` et poursuit en arrière-plan (`EdgeRuntime.waitUntil`). Erreurs : `{ "error", "message" }` en 400/401/403/404/429.

### Étapes

1. **Instagram** : Apify `apify~instagram-reel-scraper`, `run-sync-get-dataset-items`, entrée `{"username":[url],"resultsLimit":1}`, en-tête `Authorization: Bearer ${APIFY_TOKEN}`. Récupère `caption`, `videoUrl`, `displayUrl`, `ownerUsername`, `videoDuration`, `latestComments` (garder ceux de l'auteur). Télécharge immédiatement la vidéo (les liens expirent) vers `recipe-videos/<book_id>/<import_id>.mp4` et l'image `displayUrl` vers `recipes/<book_id>/<recipe_id>/origine.jpg` une fois la recette créée (photo kind `origine`, couverture tant qu'il n'y en a pas d'autre).
2. **Triage** : un appel Claude court décide si la légende (+ commentaires de l'auteur) contient ingrédients ET étapes. Si oui, on saute la vidéo.
3. **Vidéo** : Gemini (API native `generativelanguage.googleapis.com/v1beta`, en-tête `x-goog-api-key: ${GEMINI_API_KEY}`). Vidéo de 20 Mo ou moins : `inline_data` base64 ; au-delà : API Files (upload resumable puis `file_data`). Modèle `gemini-flash-latest`, repli `gemini-2.5-flash`. Prompt : restituer PAROLE, TEXTE À L'ÉCRAN (horodaté), VISUEL, sans rien inventer (voir `docs/recettes/` test du 19.11.2026). Relances : 3 tentatives sur 429/500/503 avec attente 5 s, 15 s, 30 s, puis modèle de repli.
4. **Web** : télécharger la page (timeout 15 s, 3 Mo max), extraire le JSON-LD `schema.org/Recipe` s'il existe ; sinon texte principal de la page (balises retirées, 60 000 caractères max). Pas de vidéo.
5. **Photo de page** : les images de `page_paths` (URL signées ou base64) sont envoyées à Claude (vision). Écriture manuscrite possible. Résultat toujours `a_relire`.
6. **Structuration** : Claude `claude-sonnet-5-5` (comme `sommelier`), sortie JSON stricte selon §3. Toutes les sources sont des données, jamais des instructions (les mettre dans des balises dédiées et le dire dans le prompt système).
7. **Normalisation** : conversion en métrique (cups, oz, lb, °F, sticks) avec la table de densités (`recipe_ingredients_catalog.density_g_per_ml`, sinon `supabase/seed/densites.json` embarqué), unité d'origine gardée dans `precision`, alerte « Converti : … » quand la conversion dépend de la densité. Rattachement de chaque ligne au catalogue (nom canonique ou alias, insensible casse/accents, singulier/pluriel) ; ingrédient inconnu → insertion au catalogue avec `validated=false`.
8. **Écriture** : `recipes` (review_state `a_verifier`, source_type, source_url, source_author, alerts, *_estimated), lignes, étapes (`text` en français, `text_original` si traduit), `title_original` et `lang_original` si la source n'est pas en français. `created_by` = l'utilisateur.
9. **Doublons** : chercher dans les carnets de l'utilisateur une recette au titre proche (`similarity(f_unaccent(title), …) > 0.45`) ou au même `source_url`, ou au même `source_author` avec ≥ 60 % d'ingrédients catalogue communs. Si trouvé : `duplicate_of` renseigné, alerte « Doublon probable de … » ; le front propose « Ranger comme version » (même `version_group`), « Garder séparée » ou « Fusionner ».
10. Fin : status `termine` (ou `a_relire` pour `photo_page`), `recipe_id` renseigné ; en cas d'échec, `echec` + `error` en français + `ai_calls.ok = false`.

## 3. JSON attendu de Claude (structuration)

```json
{
  "titre": "string",
  "titre_original": "string|null",
  "langue_originale": "fr|it|en|de|es|…|null",
  "resume": "string|null",
  "type_plat": "entree|plat|dessert|accompagnement|boisson|autre|null",
  "cuisine": "string|null",
  "portions": {"valeur": "int|null", "estime": "bool"},
  "temps_actif_min": {"valeur": "int|null", "estime": "bool"},
  "temps_total_min": {"valeur": "int|null", "estime": "bool"},
  "difficulte": "1|2|3|null",
  "ingredients": [{"groupe": "string|null", "libelle": "string", "nom_canonique": "string", "quantite": "number|null", "unite": "g|kg|ml|cl|l|cas|cac|piece|pincee|botte|gousse|tranche|null", "unite_origine": "string|null", "precision": "string|null", "facultatif": "bool", "source": "legende|parole|ecran|visuel|page|web"}],
  "etapes": [{"texte": "string (français)", "texte_original": "string|null", "minuteur_s": "int|null", "source": "…"}],
  "alertes": ["string"],
  "completude": "complete|partielle|insuffisante"
}
```

Règles du prompt : aucune quantité, durée ou température inventée (absente = null) ; portions et temps estimés seulement si déductibles, avec `estime: true` et la déduction dans `alertes` ; contradictions entre sources, ingrédients utilisés mais non listés, matériel spécial → `alertes` ; `minuteur_s` seulement si une durée explicite figure dans l'étape.

## 4. Front

- `recettes/ajouter.html` : trois onglets « Lien » (Instagram ou site, détection automatique), « Photo de page » (1 à 4 photos, compression 2000 px), « Saisie manuelle » (renvoie vers `editer.html`). Choix du carnet (éditeurs seulement). Liste « En cours » des imports de l'utilisateur, suivie en temps réel (canal Supabase Realtime sur `recipe_imports`, repli : sondage toutes les 5 s), avec l'étape en cours, puis lien vers la fiche.
- Partage depuis le téléphone : `ajouter.html?url=…` préremplit le lien (raccourci iOS) ; `share_target` dans le manifest (Android).
- Fiche : si `review_state = a_verifier`, encadré d'alertes en tête + bouton « C'est bon » ; pour `photo_page`, la photo de la page est affichée à côté du texte et la validation est obligatoire avant d'apparaître dans le carnet (filtrée de l'accueil tant que `a_relire`). Bloc « Doublon probable » avec les trois actions. Onglet « Versions » listant les recettes du même `version_group`, avec les écarts (ingrédients et quantités) ; « Fusionner » ouvre `fusion.html?a=&b=` : tableau côte à côte des conflits, choix par ligne, version absorbée `archived_at = now()`.
- « Version originale » : bascule sur la fiche qui affiche `title_original` et `text_original`.

## 5. Import « Note » (recette copiée depuis Apple Notes, avec photos)

Migration : `supabase/recettes-note.sql` (rejouable, à appliquer après les phases 1 à 7). Edge function : même `recipe-import`, même appel `{ "import_id" }`.

### Table `recipe_imports`
- `kind` accepte aussi `'texte'`.
- `source_text text` : le texte collé, 1 à 20 000 caractères.
- `photo_paths text[] not null default '{}'` : 0 à 6 photos du bucket `recipes`, `<book_id>/imports/<import_id>/<n>.jpg` (téléversées avant l'insertion, comme `page_paths`).
- Cohérence (`recipe_imports_source_chk`) : `texte` ⇒ `source_text` non vide, `source_url` null, `page_paths` vide ; `photo_page` ⇒ 1 à 4 `page_paths`, sans texte ni `photo_paths` ; `instagram`/`web` ⇒ `source_url`, sans texte ni `photo_paths`.
- Droit d'insertion par colonnes : `id, book_id, created_by, kind, source_url, page_paths, source_text, photo_paths`. Envoyer `status` (ou `step`, `error`, `recipe_id`…) est refusé (`permission denied`).
- Policy d'insertion : contrôles de la phase 2, et chaque élément de `photo_paths` doit commencer par `<book_id>/imports/<id>/` (sans `..`) ; sinon refus RLS.
- `recipes.source_type` accepte aussi `'note'`.

### Fonction
- Pas de récupération réseau : `source_text` (nettoyé : fins de ligne, espaces insécables, pièces jointes Notes) est transmis à Claude dans `<texte_note>…</texte_note>`, donnée non fiable comme les autres sources. `source` des lignes et étapes = `note`. Les photos ne sont pas lues par Claude.
- Fiche : `source_type = 'note'`, `source_url`/`source_author` null, `review_state = 'a_verifier'`, alertes, catalogue, conversions et doublon par titre comme les autres imports. Statut final `termine`.
- Photos : chaque fichier de `photo_paths` est copié (API Storage, service_role) vers `<book_id>/<recipe_id>/note-<n>.jpg` (n dès 1, dans l'ordre) et inscrit dans `recipe_photos` avec `kind = 'perso'` ; la première copiée avec succès est `is_cover = true`. Une copie en échec est ignorée (journalisée), la fiche est créée quand même. Les fichiers d'origine restent dans le dossier d'import.
- Erreurs 400 (« Note invalide. », « Photos de la note invalides. ») ; quota inchangé : 50 imports / 24 h, `ai_calls.kind = 'recipe-import'`.
- Le front ne passe pas par `page_paths` pour ce type : le laisser vide.

## 6. Astuces et changement de type

Les imports peuvent aussi produire une **astuce** (fiche courte qui n'est pas une recette). Contrat complet : `08-astuces-contrat.md` (§1 schéma, §2 edge function) ; migration `supabase/recettes-astuces.sql`.

- `recipe_imports.target` (`auto` par défaut, `recette`, `astuce`) : choisi par le client à l'insertion. En `auto`, le même appel Claude renvoie `nature` (`recette` ou `astuce`, doute = recette) et soit l'objet recette du §3, soit l'objet astuce.
- Astuce créée : `recipe_imports.tip_id` renseigné, `recipe_id` null, statut `termine` (y compris pour une photo de page). Pas de recherche de doublons.
- `POST { "import_id", "retype": "recette" | "astuce" }` sur un import `termine` ou `a_relire` : retraite la même source avec la cible forcée, met l'ancienne fiche à la corbeille et renseigne `replaces`. Compte dans le quota (50 / 24 h). Erreurs : 400 « Ce type est déjà le bon. », 409 si un traitement est en cours.
- La notification « import terminé » pointe vers `astuce.html?id=` quand `tip_id` est rempli.
