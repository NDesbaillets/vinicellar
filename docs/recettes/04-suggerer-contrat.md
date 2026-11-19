# ARÔMES V&N · Phase 4 « Suggérer » : contrat front / backend

Migration : `supabase/recettes-phase4.sql` (rejouable, à exécuter après `recettes.sql` et `recettes-phase3.sql`).
Edge function : `supabase/functions/recipe-search/`. Cadrage : `01-cadrage.md` §4. Aucun accès `anon`. Toutes les
lectures passent par la RLS : le front utilise la clé publique et la session de l'utilisateur, jamais `service_role`.

## 1. Tables

### `recipe_profiles` (un profil par personne, privé)

| Colonne | Type | Remarque |
|---|---|---|
| `user_id` | uuid pk | défaut `auth.uid()` |
| `allergens` | text[] | codes UE : gluten, crustaces, oeufs, poisson, arachides, soja, lait, fruits_a_coque, celeri, moutarde, sesame, sulfites, lupin, mollusques |
| `aversions` | uuid[] | ids de `recipe_ingredients_catalog` |
| `aversions_texte` | text[] | aversions hors catalogue (3 caractères au moins, comparées au libellé des lignes, sans accents) |
| `regime` | text null | `omnivore`, `flexitarien`, `vegetarien`, `vegan`, `pescetarien`, `sans_gluten`, `sans_lactose` |
| `difficulte_semaine` | smallint null | 1 à 3, difficulté max acceptée en semaine |
| `updated_at` | timestamptz | mis à jour par trigger |

Droits : chacun lit, crée, modifie, supprime sa seule ligne. Les autres membres de ses carnets n'y accèdent que par
`book_people_profiles` (voir §2), sans `difficulte_semaine`.

```js
// lire / enregistrer son profil (upsert sur la clé primaire)
const { data: profil } = await sb.from('recipe_profiles').select('*').maybeSingle();
await sb.from('recipe_profiles').upsert({ user_id: uid, allergens, aversions, aversions_texte, regime, difficulte_semaine });
```

### `recipe_feedback` (« Pas cette fois » / « Jamais »)

Clé `(user_id, recipe_id)`, `kind` = `pas_cette_fois` ou `jamais`, `created_at`. Chacun ses lignes ; l'insertion exige
d'être membre du carnet de la recette. « Pas cette fois » masque la recette 14 jours (depuis `created_at`) ; « Jamais »
la masque sans limite. Un nouveau choix remplace l'ancien. Les retours ne sont lus que par l'appelant : ils n'affectent
que ses propres suggestions.

```js
// Pas cette fois (réécrire created_at relance les 14 jours)
await sb.from('recipe_feedback').upsert(
  { user_id: uid, recipe_id, kind: 'pas_cette_fois', created_at: new Date().toISOString() });
// Jamais
await sb.from('recipe_feedback').upsert({ user_id: uid, recipe_id, kind: 'jamais', created_at: new Date().toISOString() });
// Annuler (Jamais comme Pas cette fois)
await sb.from('recipe_feedback').delete().eq('recipe_id', recipe_id);
// Lister les « Jamais » pour un écran de réglages
await sb.from('recipe_feedback').select('recipe_id, created_at').eq('kind', 'jamais');
```

## 2. Fonctions (RPC, rôle `authenticated`)

### `book_people_profiles(b uuid)` : « Pour qui ? »

Renvoie `user_id, allergens, aversions, aversions_texte, regime` des membres du carnet `b` qui ont un profil.
Vide si l'appelant n'est pas membre. Les noms viennent de `book_people(b)` (phase 1).

```js
const { data } = await sb.rpc('book_people_profiles', { b: bookId });
```

Texte à afficher dans le sélecteur « Pour qui ? » : « Les allergies, aversions et régimes des personnes cochées sont
respectés. Chacun voit celles des autres membres du carnet, pas ses préférences de difficulté. »

### `recipe_suggestions(p_book_ids, p_for_users, p_month, p_limit, p_weekday)`

| Paramètre | Défaut | Rôle |
|---|---|---|
| `p_book_ids uuid[]` | obligatoire | carnets (ceux de l'appelant ; les autres sont ignorés par la RLS) |
| `p_for_users uuid[]` | `null` | personnes visées ; null ou vide = l'appelant seul. Seuls les membres de `p_book_ids` comptent. |
| `p_month int` | mois courant (Europe/Zurich) | 1 à 12, sinon erreur « mois invalide » |
| `p_limit int` | 12 | borné à 1 à 100 |
| `p_weekday boolean` | jour courant ≤ vendredi | permet de planifier un jour précis (facilité) |

Sortie : `recipe_id uuid, score numeric (0 à 100, 1 décimale), raisons text[]`, trié par score décroissant. Le front
récupère ensuite les fiches : `sb.from('recipes').select('id,title,...').in('id', ids)` et réordonne.

```js
const { data, error } = await sb.rpc('recipe_suggestions', {
  p_book_ids: [bookId1, bookId2], p_for_users: [uidAnna, uidBen], p_limit: 12 });
// data = [{ recipe_id, score: 85.3, raisons: ['De saison : céleri, potiron', 'Noté 5/5, pas refait depuis 7 semaines', 'Prête en 25 min'] }]
```

Poids fixes (sur 100) :

| Critère | Poids | Calcul |
|---|---|---|
| Saison | 35 | part des ingrédients saisonniers (1 à 11 mois de saison, hors lignes optionnelles) de saison au mois donné, lissée `(en saison + 0,5) / (saisonniers + 1)` ; neutre (0,5) sans ingrédient saisonnier ; +0,25 (plafonné à 1) si un ingrédient `short_season` est de saison |
| Goûts | 30 | `(moyenne des notes des personnes visées - 1) / 4` ; neutre (0,5) sans note de leur part |
| Variété | 20 | jours depuis la dernière cuisson (par n'importe quel membre du carnet), plafonné à 90, divisé par 90 ; jamais cuisinée : 0,7 |
| Facilité | 15 | en semaine : 0,6 x rapidité (30 min ou moins = 1, 120 min ou plus = 0, inconnu 0,5) + 0,4 x simplicité (difficulté 1 = 1, 2 = 0,5, 3 = 0 ; 0 au-delà de la `difficulte_semaine` de l'appelant) ; week-end : 0,5 pour tous |

Exclusions strictes : recette supprimée, archivée ou « À vérifier » ; allergène, aversion (catalogue ou texte) ou régime
incompatible pour **l'une quelconque** des personnes visées ; retour actif de l'appelant. Régimes, via les allergènes
et les rayons du catalogue : `vegetarien` exclut boucherie, poissonnerie, poisson, crustacés, mollusques ;
`pescetarien` exclut boucherie ; `vegan` ajoute crémerie, lait, oeufs ; `sans_gluten` exclut gluten ; `sans_lactose`
exclut lait ; `omnivore` et `flexitarien` n'excluent rien. Les lignes sans ingrédient du catalogue échappent à ces
contrôles (sauf aversions en texte) : l'affichage d'une alerte « ingrédients non rattachés » est à la charge du front.

Textes de `raisons` (au plus trois, dans cet ordre, à afficher tels quels, une ligne par raison) :
« De saison : truffe blanche, céleri » (3 noms au plus) ; « Noté 5/5, pas refait depuis 7 semaines » (note ≥ 4 ;
« pas refait » seulement après 28 jours) ; « Pas encore essayée » ; « Pas refaite depuis 2 mois » ; « Prête en 25 min »
(40 min ou moins) ; « Facile à réaliser » (difficulté 1 sans durée connue). Texte sous le titre de l'écran :
« Suggestions selon la saison, vos cuissons passées, le temps depuis la dernière fois et la facilité. » Boutons :
« Pas cette fois » (masquée 14 jours) et « Jamais » (annulable dans les réglages).

### `recipe_with_what_i_have(p_book_ids, p_catalog_ids, p_limit)` : « Avec ce que j'ai »

`p_catalog_ids` = ingrédients que la personne a (ids du catalogue, choisis par recherche dans le catalogue).
Sortie : `recipe_id, missing_count int, needed_count int, missing_ids uuid[], missing_names text[], uncatalogued_count int`,
classé par `missing_count` croissant, puis `uncatalogued_count`, puis nombre d'ingrédients que l'on a. Ne comptent pas
comme manquants : lignes `optional`, rayon `epices`, sel, poivre, huile, eau. Au moins un ingrédient possédé requis ;
recettes supprimées, archivées ou « À vérifier » ignorées. `uncatalogued_count` = lignes non optionnelles sans
ingrédient du catalogue, non évaluables : afficher « + N ingrédient(s) à vérifier » si > 0. Limite 1 à 100 (défaut 20).

```js
const { data } = await sb.rpc('recipe_with_what_i_have', { p_book_ids: [bookId], p_catalog_ids: ids, p_limit: 20 });
// Texte : « Il vous manque : beurre » / « Rien à acheter » si missing_count = 0
```

### `recipe_search(...)` : recherche à filtres (sert aussi à recipe-search)

Paramètres (tous optionnels sauf `p_book_ids`) : `p_texte, p_course, p_cuisine, p_time_max, p_diff_max, p_inc uuid[],
p_exc uuid[], p_inc_txt text[], p_exc_txt text[], p_month, p_regime, p_limit` (défaut 30, max 100). Texte tolérant aux
accents et aux fautes (plein texte français + trigrammes sur le titre). Sortie : `recipe_id, book_id, title, course,
cuisine, time_total_min, difficulty, servings, family, review_state, rank`. Les recettes « À vérifier » sont incluses
(`review_state` permet de les marquer) ; supprimées et archivées jamais.

## 3. Edge function `recipe-search`

`POST /functions/v1/recipe-search`, en-têtes `Authorization: Bearer <jwt de session>` et `apikey`.

```js
const { data, error } = await sb.functions.invoke('recipe-search', {
  body: { q: 'un dessert rapide sans crème pour cet automne', book_ids: [bookId] } });
```

`q` : 2 à 300 caractères ; `book_ids` : jusqu'à 20 uuid (vide = tous les carnets de l'utilisateur). Réponse 200 :

```json
{
  "filtres": { "texte": null, "type_plat": "dessert", "cuisine": null, "temps_total_max": 30, "difficulte_max": null,
               "ingredients_inclus": [], "ingredients_exclus": ["crème"], "saison_mois": 10, "regime": null },
  "ingredients": { "inclus": [], "exclus": ["crème"], "non_reconnus": [] },
  "degrade": false,
  "recettes": [ { "id": "…", "book_id": "…", "title": "…", "course": "dessert", "cuisine": null,
                  "time_total_min": 25, "difficulty": 1, "servings": 4, "family": false, "review_state": "valide" } ]
}
```

Le front affiche `filtres` en pastilles retirables (« Dessert », « 30 min max », « Sans crème », « Octobre ») : la
personne vérifie ce que Claude a compris ; un retrait relance `recipe_search` directement (RPC) sans repasser par
Claude. `ingredients.non_reconnus` : noms absents du catalogue, cherchés dans le libellé des lignes. `degrade: true` :
Claude n'a pas répondu, la question a été cherchée comme texte simple (message conseillé : « Recherche simplifiée : le
langage naturel est indisponible »). Erreurs : 400 `bad_request`, 401 `auth`, 405, 429 `quota` (60 par personne et par
24 h, `ai_calls.kind = 'recipe-search'`, réglable par `AI_RECIPE_SEARCH_DAILY_LIMIT`), 500 `db`, 503 `not_configured`.
Le texte de l'utilisateur est transmis à Claude dans un bloc `<question>` traité comme donnée ; la sortie est validée
(enums, bornes) avant toute requête, jamais exécutée telle quelle.

## 4. Index

Aucun index à créer pour les requêtes ci-dessus au-delà de ceux existants (`recipe_ingredient_lines_recipe_idx`,
`recipe_ingredient_lines_catalog_idx`, `recipe_cooks_recipe_idx`, `recipes_book_idx`, `recipes_search_idx`,
`recipes_title_trgm_idx`). Ajoutés : `recipe_feedback_recipe_idx`, `recipe_feedback_user_kind_idx`.

## 5. Déploiement pas à pas

1. Relire `supabase/recettes-phase4.sql` (aucun objet existant n'est modifié).
2. Supabase > SQL Editor : exécuter `supabase/recettes-phase4.sql` (rejouable). Vérifier :
   `select proname from pg_proc where proname in ('recipe_suggestions','recipe_with_what_i_have','recipe_search','book_people_profiles');`
   et que `recipe_profiles` et `recipe_feedback` ont la RLS activée.
3. Secrets (déjà en place si `sommelier` fonctionne) : `ANTHROPIC_API_KEY`. Optionnel : `AI_RECIPE_SEARCH_DAILY_LIMIT`.
4. Déployer : `supabase functions deploy recipe-search --project-ref <ref>` (JWT vérifié par défaut ; le code revérifie
   l'utilisateur).
5. Contrôle : sans `Authorization`, la fonction répond 401 ; avec une session, une question simple renvoie `filtres`
   et `recettes` ; `select kind, count(*) from ai_calls where kind = 'recipe-search' group by 1;` augmente.
6. Pré-requis de données : le catalogue doit avoir `season_months` et `short_season` renseignés (sinon la saison est
   neutre pour tous) et les lignes de recettes un `catalog_id` (sinon allergènes et régimes ne sont pas contrôlables).

## 6. Points ouverts

- Les versions d'une même recette (`version_group`) peuvent apparaître ensemble dans les suggestions.
- La difficulté acceptée en semaine d'une autre personne n'est pas lisible : seule celle de l'appelant joue.
- Un mélange « Pour qui ? » avec une personne dont le profil n'existe pas ne lui impose aucune contrainte : le front
  peut inviter à le lui faire remplir.
