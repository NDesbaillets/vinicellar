# ARÔMES V&N · Phase 3 « Cuisiner » : contrat base et serveur

Pour le développement front (`recettes/`). Source de vérité : `supabase/recettes-phase3.sql` (après `supabase/recettes.sql`) et `supabase/functions/recipe-studio/index.ts`. Cadrage : `01-cadrage.md` §3.

## 1. Journal des cuissons : `recipe_cooks`

| Colonne | Type | Remarque |
|---|---|---|
| `id` | uuid | généré ; peut être fourni par le client (rejeu hors ligne idempotent) |
| `recipe_id` | uuid | recette, suppression en cascade |
| `cooked_by` | uuid | défaut `auth.uid()` ; doit être l'utilisateur connecté |
| `cooked_on` | date | défaut aujourd'hui ; afficher en JJ.MM.AAAA |
| `rating` | smallint | 1 à 5, ou null |
| `comment` | text | 2000 caractères au plus |
| `servings` | int | > 0, portions réellement préparées |
| `photo_path` | text | `<book_id>/<recipe_id>/cuissons/<fichier>` (bucket `recipes`) |
| `created_at` | timestamptz | |

Droits (RLS) :
- Lecture : tous les membres du carnet de la recette (le journal est partagé).
- Insertion : tout membre, `reader` compris, uniquement pour lui-même (`cooked_by = auth.uid()`).
- Modification : l'auteur seul, colonnes `cooked_on, rating, comment, servings, photo_path` (pas `recipe_id`, pas `cooked_by`).
- Suppression : l'auteur seul. Un propriétaire ne supprime pas la cuisson d'un autre.
- `anon` : aucun droit.

```js
await sb.from('recipe_cooks').insert({ recipe_id, rating: 4, comment: 'Un peu salé', servings: 4, photo_path })
```

## 2. Statut dérivé : vue `recipe_status`

`select recipe_id, book_id, cook_count, last_cooked_on, avg_rating, status from recipe_status` (`security_invoker`, donc limitée aux recettes visibles de l'appelant).

- `cook_count` : nombre de cuissons du carnet, toutes personnes confondues.
- `last_cooked_on` : date, null si aucune cuisson. `avg_rating` : un chiffre après la virgule, null si aucune note.
- `status` : `'a_essayer'` (aucune cuisson) ou `'cuisinee'` (au moins une).
- « De famille » reste `recipes.family`, choix explicite et indépendant. Libellés : « À essayer », « Cuisinée », « De famille ».
- Filtre par statut : `.eq('status','cuisinee')` sur la vue, puis joindre aux recettes côté client par `recipe_id`.

## 3. Photos de cuisson

- `recipe_photos.kind` accepte désormais `'cuisson'`.
- Un `reader` peut insérer une ligne `recipe_photos` si : `kind = 'cuisson'`, `is_cover = false`, `created_by = auth.uid()` et `storage_path` commence par `<book_id>/<recipe_id>/cuissons/`. Il ne peut ni modifier ni supprimer de photo.
- Les éditeurs (`owner`, `member`) gardent tous leurs droits (y compris la couverture, toujours choisie à la main).
- Stockage : tout membre peut **téléverser** (insertion seule) sous `<book_id>/<recipe_id>/cuissons/<fichier>` ; ni sous-dossier, ni autre emplacement. Pas de remplacement (pas d'`upsert: true`) : utiliser un nom unique, par exemple `Date.now() + '-' + uuid.slice(0, 8) + '.jpg'`. Lecture : tout membre (policy existante).
- Enchaînement côté client : 1) téléverser le fichier ; 2) insérer `recipe_photos` (kind `cuisson`) ; 3) insérer `recipe_cooks` avec `photo_path`. Réduire la photo avant envoi (8 Mo maximum, JPEG/PNG/WebP/AVIF).
- Limite connue : si la cuisson est supprimée, la photo reste dans la galerie (un lecteur ne peut pas la retirer ; un éditeur le peut).

## 4. Minuteurs et mode cuisine

Aucune table nouvelle : `recipe_steps.timer_seconds` (int > 0, secondes) porte le minuteur de chaque étape ; le front peut aussi détecter des durées dans `text`. Plusieurs minuteurs simultanés, alerte sonore et écran allumé (Wake Lock) : côté client uniquement.

## 5. Ajustement des portions

Facteur `f = portions_voulues / recipes.servings` (si `servings` est null : proposer de le renseigner avant d'ajuster). Appliquer à `recipe_ingredient_lines.quantity` selon `unit` ; une quantité null reste vide (ne rien inventer). Arrondir seulement la valeur affichée, toujours à partir de la quantité d'origine (jamais d'arrondis en cascade). Q = `quantity * f`.

| Unité (`unit`) | Règle |
|---|---|
| `piece` (œufs, pièces), `gousse`, `botte` | Affichage à l'unité entière. Partie fractionnaire < 0,5 : unité inférieure ; à partir de 0,5 : **unité supérieure**. Minimum 1 si la quantité d'origine est > 0 (jamais « 0 œuf »). |
| `tranche` | Même règle que les pièces. |
| `pincee` | Inchangée (« une pincée »), quel que soit le facteur. |
| quantité vide ou `precision` du type « q.b. » | Inchangée. |
| `cas`, `cac` | Arrondi au demi le plus proche (0,5 ; 1 ; 1,5 …). Si le résultat est inférieur à 0,25 : afficher « une pointe » (ne pas afficher 0). Affichage : `½`, `1 ½`. |
| `g`, `ml`, `cl` | `g` et `ml` : arrondi à 5 si Q < 100, à 10 si Q ≥ 100. `cl` : convertir en `ml` si le facteur impose un arrondi (ou arrondir comme `ml` après conversion ×10, affichage en cl si multiple de 10 ml). |
| `kg`, `l` | Décimales d'un chiffre (1,5 kg ; 0,3 l). Si Q < 1 : basculer en g ou ml (0,3 kg devient 300 g) puis appliquer la règle g/ml. Si g/ml ≥ 1000 : basculer en kg/l. |

Règles communes : séparateur décimal virgule, pas de zéro final (1,0 devient 1). Les lignes `optional` suivent les mêmes règles. Les quantités déjà marquées estimées gardent leur marque. Un facteur de 1 n'arrondit rien (afficher la valeur d'origine telle quelle).

## 6. Fonction `recipe-studio`

`POST /functions/v1/recipe-studio`, en-tête `Authorization: Bearer <JWT utilisateur>` (via `sb.functions.invoke('recipe-studio', { body })`).

```json
{ "recipe_id": "uuid", "mode": "studio" | "illustration", "photo_id": "uuid | null" }
```

Réponse `200` : `{ "photo_id": "uuid", "storage_path": "<book_id>/<recipe_id>/studio-<horodatage>.jpg" }`. Le fichier est déjà téléversé et la ligne `recipe_photos` créée (`kind` = `studio` ou `illustration`, `is_cover = false`). Si le repli de réencodage échoue, l'extension peut être `.png` (le chemin renvoyé fait foi).

Erreurs : `{ "error": code, "message": "texte français affichable" }`.

| HTTP | `error` | Cas |
|---|---|---|
| 400 | `bad_request`, `too_large`, `has_photos` | paramètres invalides, mode studio sans `photo_id`, photo de kind `studio`, `illustration` ou `page`, format non pris en charge, recette en corbeille, mode illustration alors que la recette a déjà une photo |
| 401 | `auth` | session absente ou expirée |
| 403 | `forbidden` | lecteur (`reader`) ; photo de kind `origine` (« L'image d'un créateur ne se retouche pas… ») |
| 404 | `not_found` | recette ou photo introuvable, ou recette d'un carnet dont on n'est pas membre |
| 429 | `quota` | 15 appels par personne et par 24 h (`ai_calls.kind = 'recipe-studio'`, réglable par `AI_RECIPE_STUDIO_DAILY_LIMIT`) |
| 502 | `service`, `storage` | fal.ai indisponible, crédit épuisé, réponse illisible, enregistrement impossible |
| 503 | `not_configured` | secret `FAL_KEY` absent |

Règles à respecter dans l'interface :
- Bouton réservé aux éditeurs, visible sur une photo `perso` ou `cuisson` (mode `studio`), ou sur une recette sans aucune photo (mode `illustration`). Jamais sur une photo `origine`.
- L'appel dure 10 à 40 secondes : indicateur de progression, bouton désactivé pendant l'appel, pas de relance automatique (chaque appel est facturé et compté).
- Une photo `illustration` porte la mention discrète « illustration » partout où elle s'affiche.
- La nouvelle photo n'est jamais couverture : proposer « Choisir comme couverture » séparément.
- Un quota épuisé (429) affiche le message du serveur tel quel.

Modèles fal.ai (voir les points ouverts dans le rapport de livraison) : `fal-ai/bria/product-shot` (détourage + nouvelle scène en un appel, `placement_type: "original"`) et `fal-ai/flux/schnell` (illustration, 0,003 $ par mégapixel). Les URL sont des constantes en tête de `index.ts`.

## 7. Déploiement pas à pas (propriétaire)

1. Créer une branche de travail, relire `supabase/recettes-phase3.sql` et `supabase/functions/recipe-studio/index.ts`. Vérifier que `supabase/recettes.sql` (phase 1) est déjà appliqué sur le projet.
2. Supabase > SQL Editor : coller `supabase/recettes-phase3.sql` en entier, « Run ». Le script est rejouable sans risque. Un message « NOTICE … does not exist, skipping » est normal à la première exécution.
3. Contrôles dans le SQL Editor :
   - `select count(*) from public.recipe_status;` (renvoie le nombre de recettes, statuts tous « a_essayer »)
   - `select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'recipe_photos_kind_check';` (doit contenir `'cuisson'`)
   - `select policyname from pg_policies where tablename = 'recipe_cooks';` (4 lignes)
4. Secrets : `FAL_KEY` existe déjà (utilisée par `cutout`) ; rien à ajouter. Facultatif : `AI_RECIPE_STUDIO_DAILY_LIMIT` (défaut 15).
5. Déployer la fonction : `supabase functions deploy recipe-studio --project-ref <réf du projet vinicellar>` (laisser la vérification JWT activée, ne pas utiliser `--no-verify-jwt`). Sans CLI : Edge Functions > Create a function > nom `recipe-studio`, coller `index.ts`.
6. Vérification de bout en bout avec deux comptes (un éditeur, un lecteur) :
   - lecteur : ajouter une cuisson avec photo (doit marcher) ; modifier une recette (doit échouer) ;
   - éditeur : mode `studio` sur une photo perso (200, nouvelle photo studio dans la galerie), sur une photo origine (403) ; mode `illustration` sur une recette sans photo (200) puis sur une recette avec photo (400) ;
   - contrôler la ligne `ai_calls` (`kind = 'recipe-studio'`, `ok = true`) et le solde fal.ai (tableau de bord fal.ai > Billing).
7. Ne fusionner la branche vers `main` qu'après ces contrôles (la fusion publie le site).
