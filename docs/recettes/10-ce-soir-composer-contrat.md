# ARÔMES V&N · « Ce soir », suggestions par type, composer un menu · Contrat

Cadrage : `01-cadrage.md` §12. Migration : `supabase/recettes-ce-soir.sql` (rejouable ; après `recettes-menus.sql`). **Applicable depuis le téléphone** : aucune instruction `drop`, `revoke` ni `delete` dans le script (même dans un bloc `do`) ; les extensions de fonctions passent par `create or replace` ou par relecture `pg_get_functiondef` + `replace` (modèle : `recettes-base.sql`). Aucune signature de fonction existante n'est modifiée.

## 1. Base

### `recipes.courses_alt`
`text[] not null default '{}'`, check : chaque élément dans (`entree`,`plat`,`dessert`,`accompagnement`,`base`,`boisson`,`autre`) et différent de `course` (contrôle par déclencheur ou check `not (course = any(courses_alt))`). Sens : « peut aussi être servi en ». Exemple : salade César, `course = 'entree'`, `courses_alt = {plat}`.
- Inclus dans la recherche plein texte ? Non.
- `recipe_search` (phase 4) : le filtre `p_course` accepte aussi les recettes dont `courses_alt` contient la valeur (patch par relecture de la définition).

### `recipe_suggest_courses(...)`
Nouvelle fonction (security invoker, `stable`), mêmes paramètres que `recipe_suggestions` + `p_courses text[] default array['plat']` :
- appelle `recipe_suggestions` avec `p_limit = 100` et les autres paramètres tels quels ;
- garde les recettes dont `course = any(p_courses)` ou `courses_alt && p_courses` ; si `'plat' = any(p_courses)`, garde aussi les recettes sans type (`course is null`) ;
- même ordre (score), limite `p_limit` (défaut 12) ;
- retourne les mêmes colonnes que `recipe_suggestions` + `course text`.
`recipe_suggestions` reste inchangée (les bases restent exclues par elle).

### `recipe_tonight(p_book uuid)` (security invoker)
Renvoie la case du soir d'aujourd'hui (fuseau Europe/Zurich) du carnet : `{ plan_id, state, recipe_id, menu_id, servings, title }` ou rien.

## 2. Import
`recipe-import` : champ facultatif `"autres_types": ["plat", …]` dans le JSON recette (sous-ensemble des types, sans le type principal) → `courses_alt`. Règle du prompt : une salade, une soupe, une tarte salée, une quiche peuvent être entrée et plat ; ne remplir que si c'est un usage courant.

## 3. Front

### « Qu'est-ce qu'on mange ce soir ? »
- Bouton en tête de **Le carnet** (sous le logo, avant la recherche) et en tête de **La semaine**.
- Ouvre un panneau :
  - si la case du soir est déjà prévue (recette ou menu) : l'afficher (photo, titre, lien, « Cuisiner » vers le mode cuisine, « Changer ») ;
  - sinon (ou « Changer ») : 3 suggestions de **plats** (`recipe_suggest_courses`, `p_courses = {plat}`, `p_limit = 3`, « Pour qui ? » = moi par défaut, sélecteur comme sur Saisons), chacune avec ses raisons, « Ce sera ça » (écrit la case du soir : `recipe_meal_plan` jour = aujourd'hui, `slot = soir`, `state = prevu`, `recipe_id`, `menu_id` null) et « Autres idées » (3 suivantes). Lien « Composer un menu » vers le compositeur pré-réglé sur ce soir.
  - Carnet : le carnet préféré (`AR.getBookPref`), sélecteur si plusieurs carnets éditables.

### Suggestions : des plats
- **Saisons** (suggestions du mois), **« Remplir ma semaine »** et **suggestions du jour** de La semaine : appeler `recipe_suggest_courses` avec `p_courses = {plat}` au lieu de `recipe_suggestions`. Plus de desserts ni d'accompagnements proposés comme repas.

### Composer un menu
- `menu.html?composer=1` (option `&jour=AAAA-MM-JJ&creneau=midi|soir`) et bouton « Composer un menu » dans la liste des menus (bascule Menus) et dans le panneau « Ce soir ».
- Trois rangs par défaut : **Entrée**, **Plat**, **Dessert** ; « + Ajouter » un rang (apéritif, accompagnement, fromage) ; un rang peut être retiré.
- Chaque rang : « Choisir » (liste des recettes du carnet dont `course` ou `courses_alt` correspond au rang, recherche texte, tri par nom) ou « Suggérer » (3 idées `recipe_suggest_courses` avec `p_courses` = le rang ; une salade `entree` + alt `plat` apparaît dans les deux rangs).
- Nom du menu prérempli (« Menu du JJ.MM.AAAA ») et modifiable.
- **Enregistrer** : crée `recipe_menus` + `recipe_menu_items` (rubrique = rang, position = ordre). Si jour et créneau sont donnés : écrit aussi la case du planning (`menu_id`). Puis ouvre la fiche menu.

### Fiche recette et saisie
- `editer.html` : sous « Type de plat », cases « Peut aussi être servi en » (entrée, plat, dessert, accompagnement), le type principal désactivé.
- Fiche : la ligne de type affiche « Entrée · aussi en plat ».
- Le carnet, filtre « Type de plat » : inclut `courses_alt` (via `recipe_search`, aucune modification front si la RPC est utilisée ; sinon filtre `or`).
- Service worker : nouvelle version.
