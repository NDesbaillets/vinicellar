# ARÔMES V&N · Phase 7 « Invités et réceptions » : contrat front / backend

Migration : `supabase/recettes-phase7.sql` (rejouable), à exécuter après `recettes.sql` et les phases 2 à 6. Cadrage :
`01-cadrage.md` §9. Aucun accès `anon`. Tout passe par la RLS avec la clé publique et la session de l'utilisateur,
jamais `service_role`. Aucune edge function n'est ajoutée.

Rôles : lecture pour tous les membres du carnet (lecteurs compris), écriture pour `owner` et `member` (éditeurs). Un
lecteur voit tout (invités, allergies, réceptions) mais ne crée ni ne modifie rien ; il ne voit donc aucun bouton
d'ajout ou de modification.

## 1. Tables

### `recipe_guests` (invité propre à un carnet)

| Colonne | Type | Remarque |
|---|---|---|
| `id` | uuid pk | |
| `book_id` | uuid | obligatoire, non modifiable |
| `name` | text | 1 à 80 caractères |
| `household` | text null | foyer facultatif, 80 max, ex. « Les Dupont » |
| `allergens` | text[] | 14 codes UE (gluten, crustaces, oeufs, poisson, arachides, soja, lait, fruits_a_coque, celeri, moutarde, sesame, sulfites, lupin, mollusques) ; autre valeur refusée |
| `regime` | text null | `omnivore`, `flexitarien`, `vegetarien`, `vegan`, `pescetarien`, `sans_gluten`, `sans_lactose` |
| `aversions` | uuid[] | ids du catalogue (200 max) |
| `aversions_texte` | text[] | aversions hors catalogue (50 max, 3 caractères au moins pour compter) |
| `likes` | text null | préférences libres (2000 max) |
| `notes` | text null | remarques libres (4000 max) |
| `linked_user_id` | uuid null | compte existant, **membre du carnet** (sinon erreur « le compte lié doit être membre du carnet ») |
| `archived_at` | timestamptz null | archivé = masqué des listes et du « Pour qui ? », conservé dans l'historique |
| `created_by`, `created_at`, `updated_at` | | `created_by` doit être l'appelant à la création ; `updated_at` par trigger |

Un invité lié à un compte : les allergies, aversions et régime du **profil** de ce compte s'ajoutent à la fiche de
l'invité dans les suggestions (le compte doit être membre du carnet, `book_people_profiles`). Pour afficher les
membres à lier, utiliser `book_people(b)` (phase 1).

```js
const { data: invites } = await sb.from('recipe_guests').select('*').eq('book_id', bookId).is('archived_at', null).order('name');
await sb.from('recipe_guests').insert({ book_id: bookId, name: 'Marie', household: 'Les Dupont', allergens: ['arachides'], regime: 'vegetarien', created_by: uid });
await sb.from('recipe_guests').update({ archived_at: new Date().toISOString() }).eq('id', guestId);   // « Archiver »
```

Supprimer un invité (`delete`) le retire aussi de toutes ses réceptions et efface son historique « Cuisiné pour » :
proposer « Archiver » par défaut, « Supprimer définitivement » en second choix avec confirmation.

### `recipe_receptions`

| Colonne | Type | Remarque |
|---|---|---|
| `id`, `book_id` | uuid | `book_id` obligatoire, non modifiable |
| `day` | date | affichage JJ.MM.AAAA |
| `slot` | text null | `midi` ou `soir` |
| `title` | text null | 120 max, ex. « Anniversaire de Marie » |
| `note` | text null | 2000 max |
| `photo_path` | text null | doit commencer par `<book_id>/receptions/` (bucket `recipes`, policies d'écriture éditeurs existantes) |
| `members_count` | int null | **ajout au brief** : membres du carnet présents, hors invités, si connu ; sert aux portions du journal |
| `plan_id` | uuid null | case d'origine du planning ; **lecture seule côté client** (posé par `recipe_plan_to_reception`) |
| `created_by`, `created_at`, `updated_at` | | |

Colonnes accessibles en écriture au client : `book_id, day, slot, title, note, photo_path, members_count` (insertion),
les mêmes sauf `book_id` (modification).

### `recipe_reception_guests` (reception_id, guest_id)

Clé composite. L'invité doit appartenir au carnet de la réception. Pas de modification : on supprime puis on insère.

### `recipe_reception_dishes`

`id, reception_id, recipe_id null, label, course, position`. `course` : `aperitif`, `entree`, `plat`, `fromage`,
`dessert`, `autre`. `label` est obligatoire en base mais **rempli automatiquement avec le titre de la recette** si on
l'omet pour un plat lié ; il survit ainsi à la suppression de la recette (`recipe_id` passe alors à null). Pour un plat
hors carnet : `recipe_id` null et `label` saisi. La recette doit appartenir au carnet de la réception.

### `recipe_reception_wines`

`id, reception_id, item_id null (→ public.items), label, note`. Place prévue pour les vins Vinicellar : aucun écran
obligatoire pour l'instant (un simple champ libre « Vins » avec `label` suffit). Aucune table de la cave n'est modifiée.

```js
const { data: r } = await sb.from('recipe_receptions')
  .select('*, recipe_reception_guests(guest_id, recipe_guests(id,name)), recipe_reception_dishes(*), recipe_reception_wines(*)')
  .eq('book_id', bookId).order('day', { ascending: false });
```

## 2. Vue `recipe_served_to` (lecture)

Colonnes : `recipe_id, guest_id, guest_name, day, reception_id`. Une ligne par recette, invité et réception.
Contenu : plats liés à une recette des réceptions dont la date est aujourd'hui ou passée (Europe/Zurich), plus les
cuissons journalisées d'une réception. `security_invoker` : la RLS s'applique.

```js
// Fiche recette : « Cuisiné pour Marie, Paul »
const { data } = await sb.from('recipe_served_to').select('guest_name, day').eq('recipe_id', rid).order('day', { ascending: false });
// Fiche invité : plats déjà servis
const { data } = await sb.from('recipe_served_to').select('recipe_id, day, reception_id').eq('guest_id', gid).order('day', { ascending: false });
```

## 3. Fonctions (RPC, `authenticated`)

### `recipe_reception_log(p_reception uuid) → integer` (éditeurs)

Inscrit au journal une cuisson par recette liée de la réception : `cooked_on` = date de la réception, `cooked_by` =
appelant, `servings` = nombre d'invités + `members_count` si `members_count` est renseigné, sinon null, `reception_id`
posé. Idempotente : une recette déjà journalisée pour cette réception n'est pas recréée ; renvoie le nombre de
cuissons créées (0 au second appel). Ignore les recettes à la corbeille. Erreur 42501 pour un lecteur ou un étranger.
Une cuisson déjà créée n'est pas mise à jour si les invités changent ensuite.

```js
const { data: n } = await sb.rpc('recipe_reception_log', { p_reception: receptionId });
// n = 0 : « Déjà inscrit au journal. » ; n >= 1 : « n plat(s) inscrit(s) au journal. »
```

### `recipe_plan_to_reception(p_plan uuid, p_guest_ids uuid[]) → uuid` (éditeurs)

Pour une case du planning à l'état `invites` (sinon erreur « la case n'est pas une case invités »). Renvoie l'id de la
réception.
- Création : jour, créneau et note de la case ; invités = `p_guest_ids` (null = aucun) ; `members_count` = convives de
  la case moins les invités (null si la case n'a pas de convives) ; plat = la recette planifiée si présente
  (rubrique déduite de la recette). La case reçoit `reception_id`.
- Mise à jour (la case a déjà une réception) : jour et créneau suivent la case ; `p_guest_ids` null = invités
  inchangés, tableau (même vide) = nouvelle liste ; la recette planifiée est ajoutée aux plats si absente ; aucun plat
  n'est retiré ; titre, note, photo conservés.
- Erreur « invité inconnu dans ce carnet » si un id n'appartient pas au carnet de la case.

```js
const { data: receptionId } = await sb.rpc('recipe_plan_to_reception', { p_plan: planId, p_guest_ids: guestIds });
// Planning : une case invités avec `reception_id` non null affiche « Réception » (lien vers l'écran), sinon « Créer la réception »
```

`recipe_meal_plan.reception_id` est lisible dans `select('*')` ; le client ne peut pas l'écrire.

### `recipe_suggestions` : nouvelle signature exacte

```
recipe_suggestions(
  p_book_ids uuid[],                       -- obligatoire
  p_for_users uuid[] default null,         -- inchangé
  p_month int default <mois courant, Europe/Zurich>,
  p_limit int default 12,
  p_weekday boolean default <jour courant <= vendredi>,
  p_guest_ids uuid[] default null,         -- NOUVEAU : invités visés
  p_hide_served boolean default false      -- NOUVEAU : masquer les plats déjà servis
) returns table (recipe_id uuid, score numeric, raisons text[], deja_servi text)
```

Appel par paramètres nommés (les deux nouveaux sont en dernière position). L'ancienne signature à cinq paramètres
n'existe plus ; un appel sans `p_guest_ids` donne le même résultat qu'avant (même ensemble, même score, même ordre),
avec `deja_servi` toujours null.

- Contraintes : allergies, régime, aversions (catalogue et texte) de chaque invité visé, et celles du profil de son
  compte lié, s'appliquent comme celles des membres visés (exclusions strictes, voir `04-suggerer-contrat.md`). Les
  invités doivent appartenir à l'un des carnets de `p_book_ids` (les autres sont ignorés).
- `p_for_users` vide ou null = l'appelant seul, même si des invités sont fournis : pour une réception où l'appelant
  n'est pas concerné, ou pour y ajouter d'autres membres, passer explicitement les membres cochés.
- `deja_servi` : null, ou « Déjà servi à Marie le 12.03.2026, Paul le 04.06.2025 » (dernière date par invité, du plus
  récent au plus ancien, à afficher tel quel sous la recette).
- Ordre : les recettes sans mention d'abord (score décroissant), puis les recettes déjà servies (score décroissant).
  `p_limit` s'applique après ce classement.
- `p_hide_served = true` : les recettes déjà servies à au moins un des invités visés sont retirées.

```js
const { data } = await sb.rpc('recipe_suggestions', {
  p_book_ids: [bookId], p_for_users: [uidAnna], p_guest_ids: [guestMarie, guestPaul], p_hide_served: masquer, p_limit: 12 });
```

## 4. Écrans attendus et textes

1. **Liste des invités** (« Invités ») : cartes par nom, foyer en sous-titre, pastilles d'allergènes ; recherche par
   nom (sans accents) ; filtre « Archivés ». Bouton « Nouvel invité » (éditeurs). Vide : « Aucun invité pour
   l'instant. Ajoutez les personnes que vous recevez pour tenir compte de leurs allergies et de ce qu'elles ont déjà mangé. »
2. **Fiche invité** : formulaire « Nom », « Foyer (facultatif) », « Allergies », « Régime », « Aversions »,
   « Ce qu'il ou elle aime », « Remarques », « Compte lié (facultatif) » (liste des membres du carnet ;
   aide : « Ses allergies et préférences de profil s'ajoutent à cette fiche. »). Sections : « Réceptions » (date
   JJ.MM.AAAA, titre, menu en rubriques) et « Plats déjà servis » (recette, date, via `recipe_served_to`).
   Actions : « Archiver », « Supprimer ». Lecteur : lecture seule.
3. **Création de réception** : depuis le planning (case « invités » : « Créer la réception », choix des invités,
   `recipe_plan_to_reception`) ou après coup (« Nouvelle réception » : date, créneau, titre, invités, plats par
   rubrique avec choix d'une recette du carnet ou libellé libre, vins, note, photo, « Membres présents »). Bouton
   « Inscrire au journal » (`recipe_reception_log`) ; message de retour ci-dessus.
4. **Fiche recette** : dans l'historique, ligne « Cuisiné pour Marie, Paul » avec la date (regrouper par réception).
5. **Sélecteur « Pour qui ? »** : sous les membres, section « Invités » (cases à cocher, invités archivés exclus),
   transmise à `p_guest_ids`. Interrupteur « Masquer les plats déjà servis » → `p_hide_served`. Texte d'aide :
   « Les allergies, aversions et régimes des invités cochés sont respectés. » Mention d'une recette déjà servie :
   `deja_servi`.

## 5. Confidentialité

Allergies, régimes et remarques sur des tiers sont des données de santé de personnes qui ne sont pas utilisatrices.
- Jamais dans `recipe-public` (lien public), jamais dans le livre PDF, jamais dans l'export JSON par défaut :
  aucune de ces sorties ne lit `recipe_guests`, `recipe_receptions*`, `recipe_served_to`. Aucun champ de la fiche
  recette ne les expose (pas de « Cuisiné pour » sur la page publique, le livre ni l'export).
- Visibles de tous les membres du carnet, lecteurs compris (cadrage §9). Un étranger ne voit rien.
- L'export JSON complet du carnet (si un jour prévu) devra être une option explicite « Inclure les invités ».
- « Transmettre » une recette vers un autre carnet ne copie ni invités ni réceptions ni journal.
- Ne pas stocker de nom d'invité dans des journaux côté client (console, analytics).

## 6. Déploiement

1. Exécuter `supabase/recettes-phase7.sql` dans le SQL Editor (après les phases 1 à 6). Rejouable. **Ne pas rejouer
   `recettes-phase4.sql` ensuite** : il recréerait l'ancienne signature de `recipe_suggestions` et rendrait ambigus
   les appels nommés ; si cela arrive, rejouer la phase 7.
2. Déployer le front en même temps ou après : l'ancien front appelle `recipe_suggestions` sans les nouveaux
   paramètres, ce qui continue de fonctionner (colonne supplémentaire `deja_servi` ignorée).
3. Contrôles : `select relrowsecurity from pg_class where relname in ('recipe_guests','recipe_receptions','recipe_reception_guests','recipe_reception_dishes','recipe_reception_wines');` (5 fois `true`) ;
   `select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'recipe_suggestions';` (une seule ligne, 7 arguments) ;
   `select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_name like 'recipe_%guest%';` (0).
4. Aucun secret, aucune edge function, aucun stockage nouveau (photos de réception sous `<book_id>/receptions/`, policies existantes).

## 7. Points ouverts

- `members_count` (colonne ajoutée) et sa déduction depuis les convives d'une case (`servings - invités`) : à confirmer.
- « Plats déjà servis » = plats de réceptions passées, journalisés ou non (un menu non encore inscrit au journal compte
  quand sa date est passée) : à confirmer.
- Un lecteur ne peut pas inscrire de cuisson de réception (réservé aux éditeurs, comme la création de la réception).
- Les vins : modèle seul, aucune logique ; la liaison aux sorties de cave du jour viendra plus tard.
