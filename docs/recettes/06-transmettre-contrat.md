# Phase 6 · Transmettre : contrat serveur pour le front

Fichiers : `supabase/recettes-phase6.sql`, `supabase/functions/recipe-public/`, `supabase/functions/recipe-transmit/`.
Cadrage : `01-cadrage.md` §1 et §6. Reste à faire côté front : accord Vinicellar (fonction `sommelier` existante), export JSON, livre PDF.

## 1. Lien public

### Table `recipe_public_links`

| Colonne | Type | Remarque |
|---|---|---|
| `id` | uuid | |
| `recipe_id` | uuid | recette partagée (cascade à la suppression définitive) |
| `token` | text | 43 caractères base64url, généré par la base (trigger) ; toute valeur envoyée est refusée |
| `created_by`, `created_at` | | |
| `revoked_at` | timestamptz null | non nul = lien révoqué |

Droits (RLS) : lecture par tous les membres du carnet de la recette ; création et révocation par owner et member ; reader : lecture seule ; anon : aucun accès. Un seul lien actif par recette (index unique partiel) ; un lien révoqué ne se réactive pas, on en crée un nouveau.

Appels supabase-js (session de l'utilisateur) :

```js
// État du lien : null = pas de partage actif
const { data } = await sb.from('recipe_public_links')
  .select('id, token, created_at').eq('recipe_id', recipeId).is('revoked_at', null).maybeSingle();

// Créer (colonne insérable : recipe_id seulement)
const { data: created, error } = await sb.from('recipe_public_links')
  .insert({ recipe_id: recipeId }).select('id, token').single();
// error.code === '23505' : un lien actif existe déjà -> relire.
// RLS (reader) : erreur 42501 -> afficher « Seuls les propriétaires et membres peuvent partager. »

// Révoquer (colonne modifiable : revoked_at seulement)
await sb.from('recipe_public_links').update({ revoked_at: new Date().toISOString() }).eq('id', linkId);
```

URL publique à afficher et copier : `https://vinicellar.ch/recettes/partage.html?t=<token>`. Le bouton « Révoquer » rend l'URL inopérante (404 immédiat côté fonction, cache navigateur 60 s au plus).

### Fonction `recipe-public` (sans compte)

`GET https://<projet>.supabase.co/functions/v1/recipe-public?t=<token>`

Appel depuis `partage.html` : `fetch(url)` sans en-tête `Authorization`. Si la passerelle Supabase en réclame un malgré le déploiement sans JWT, ajouter l'en-tête `apikey` avec la clé publique (anon) déjà présente dans le code du site ; c'est une clé publique, pas un secret.

Réponse 200 :

```json
{
  "title": "Tarte aux pommes", "title_original": null, "lang_original": null,
  "summary": "…", "course": "dessert", "cuisine": "française", "difficulty": 2,
  "servings": 6, "servings_estimated": false,
  "time_active_min": 30, "time_active_estimated": false,
  "time_total_min": 90, "time_total_estimated": true,
  "credit": { "source_type": "instagram", "author": "@nom", "url": "https://…" },
  "ingredients": [ { "group_label": "Pour la pâte", "label_original": "farine", "quantity": 250, "unit": "g", "precision": null, "optional": false } ],
  "steps": [ { "text": "…", "timer_seconds": 600 } ],
  "photos": [ { "url": "https://…signée…", "kind": "origine", "cover": true } ],
  "photos_expire_in": 3600
}
```

- Photos incluses : `origine`, `perso`, `studio`, `illustration` (couverture en premier). Exclues : `page` et `cuisson`. `credit.url` est toujours http(s) ou `null` ; afficher « Recette de <author> » avec ce lien (le créateur est toujours crédité). Une illustration générée porte la mention discrète « illustration » (`kind === 'illustration'`).
- Jamais renvoyés : notes, membres, e-mails, id de carnet ou de recette, chemins Storage, cuissons.
- Les URL de photos expirent après 1 h : recharger la page pour en obtenir de nouvelles.
- Erreurs : 404 `{error:'not_found', message}` (jeton inconnu, malformé, révoqué, recette en corbeille ou supprimée) ; 429 (plus de 60 requêtes par minute et par IP) ; 405.
- En-têtes : `X-Robots-Tag: noindex, nofollow`, `Cache-Control: public, max-age=60`, `Access-Control-Allow-Origin: *`. La page `partage.html` doit aussi porter `<meta name="robots" content="noindex,nofollow">` et `<meta name="referrer" content="no-referrer">`.
- Limitation par IP : compteur en mémoire de l'instance de la fonction (pas de table). Elle est donc approximative (une instance par région et par vague de trafic). Le jeton de 256 bits rend l'énumération impossible ; au besoin, une limitation stricte se fait au niveau du pare-feu / CDN.

## 2. Transmettre vers un autre carnet : `recipe-transmit`

`POST https://<projet>.supabase.co/functions/v1/recipe-transmit` (JWT de l'utilisateur, par `sb.functions.invoke`)

```js
const { data, error } = await sb.functions.invoke('recipe-transmit', {
  body: { recipe_id, target_book_id }
});
// data = { recipe_id: '<nouvelle recette>', photos_copied: 3, photos_skipped: 0 }
```

Règles : l'appelant est membre (tout rôle) du carnet de la recette et owner ou member du carnet cible, distinct du carnet source. Les carnets proposés dans le sélecteur « Transmettre vers » : ceux où le rôle est `owner` ou `member`, hors carnet courant.

Copié : recette (`review_state` conservé ; `family` remis à faux ; ni corbeille ni archivage ni `version_group`), lignes d'ingrédients, étapes, photos (fichiers copiés vers `<carnet cible>/<nouvelle recette>/…`, couverture comprise). `created_by` = l'appelant ; `transmitted_from` = id de l'original, à afficher comme « Transmise depuis… » si l'utilisateur a encore accès à l'original (`select` sur `recipes` ; sinon masquer, la colonne passe à `null` si l'original est supprimé définitivement).
Non copié : toutes les notes (partagées ou privées : elles appartiennent au carnet d'origine), le journal des cuissons et leurs photos, les liens publics.

Erreurs (`{error, message}` en français, `message` affichable tel quel) : 400 (identifiants invalides, même carnet), 401 (session), 403 (cible en lecture seule), 404 (recette ou carnet introuvable ou inaccessible), 429 (100 transmissions par 24 h, `RECIPE_TRANSMIT_DAILY_LIMIT`), 500 (échec de copie : tout est annulé). Chaque appel est journalisé dans `ai_calls` (`kind = 'recipe-transmit'`).

## 3. Export JSON du carnet (client)

Aucune fonction serveur : le client charge avec sa session (la RLS limite aux données du carnet), puis télécharge un fichier `aromes-<nom-du-carnet>-JJ.MM.AAAA.json`. Chargement :

```js
recipe_books (id, name)                                   // carnet exporté
recipes (*) where book_id = X and deleted_at is null and archived_at is null
recipe_ingredient_lines (*) where recipe_id in (…)        // ordre position
recipe_steps (*)          where recipe_id in (…)
recipe_photos (recipe_id, kind, is_cover, storage_path) where recipe_id in (…) and kind <> 'cuisson'
recipe_cooks (*)          where recipe_id in (…)          // partagé avec le carnet
recipe_notes (*)          where recipe_id in (…)          // la RLS exclut déjà les notes privées d'autrui
```

Charger par paquets de 100 identifiants (`in`). Forme du fichier (version 1) :

```json
{
  "format": "aromes-vn-export", "version": 1,
  "exported_at": "2026-11-20T10:00:00Z",
  "book": { "name": "Carnet de Marie" },
  "recipes": [
    {
      "title": "…", "title_original": null, "lang_original": null, "summary": null,
      "course": "plat", "cuisine": null, "difficulty": 2, "family": false,
      "servings": 4, "servings_estimated": false,
      "time_active_min": 20, "time_active_estimated": false, "time_total_min": 45, "time_total_estimated": false,
      "review_state": "valide",
      "source": { "type": "instagram", "url": "https://…", "author": "@nom" },
      "created_at": "2026-11-01T08:00:00Z",
      "ingredients": [ { "group": null, "label": "farine", "quantity": 250, "unit": "g", "precision": null, "optional": false } ],
      "steps": [ { "text": "…", "timer_seconds": null } ],
      "photos": [ { "kind": "origine", "cover": true, "file": "photos/001-tarte.jpg" } ],
      "cooks": [ { "date": "2026-11-10", "rating": 4, "comment": "…", "servings": 4 } ],
      "notes": [ { "body": "…", "private": false, "own": true } ]
    }
  ]
}
```

Règles : ni identifiant interne, ni e-mail, ni chemin Storage, ni nom d'autre membre. Les notes privées d'un autre membre n'arrivent jamais (RLS). Les photos ne sont pas incorporées dans le JSON (`file` est un nom indicatif) ; si l'on veut les fichiers, produire un ZIP côté client via URL signées (`createSignedUrls`, 1 h) : option à décider.

## 4. Livre PDF (client, page imprimable)

Page `recettes/livre.html?book=<id>` en CSS `@page` (A4 ou A5), imprimée en PDF par le navigateur (« Enregistrer en PDF »). Structure : couverture (nom du carnet, logo, date JJ.MM.AAAA), sommaire, un chapitre par `course` (entrée, plat, dessert, accompagnement, boisson, autre), une double page par recette : photo de couverture en planche, titre, source et crédit, portions et temps, ingrédients groupés, étapes numérotées, notes en marge (notes partagées uniquement : exclure les notes privées même les siennes, le livre est destiné à être donné).

Données à charger (même requêtes que l'export §3, sans `recipe_cooks`) :
- `recipes` du carnet (hors corbeille et archivées), triées par `course` puis `title`.
- `recipe_ingredient_lines` et `recipe_steps` par recette, ordre `position`.
- `recipe_photos` hors `cuisson` et `page` ; URL signées via `sb.storage.from('recipes').createSignedUrls(paths, 3600)` (session de l'utilisateur, la RLS Storage s'applique). Attendre le chargement des images (`img.decode()`) avant `window.print()`.
- `recipe_notes` où `private = false`.

## 5. Déploiement pas à pas

1. Prérequis : `recettes.sql` et `recettes-phase3.sql` déjà appliqués. Relecture du diff.
2. SQL Editor : exécuter `supabase/recettes-phase6.sql` (rejouable). Contrôle : `select count(*) from recipe_public_links;` renvoie 0 ; `select has_table_privilege('anon','public.recipe_public_links','select');` renvoie `false` ; `recipes.transmitted_from` existe.
3. Edge functions (CLI Supabase, projet vinicellar) :
   - `supabase functions deploy recipe-transmit` (JWT vérifié par défaut).
   - `supabase functions deploy recipe-public --no-verify-jwt` (accès anonyme : seule exception ; ou `[functions.recipe-public] verify_jwt = false` dans `supabase/config.toml`).
   - Aucun nouveau secret : `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis par la plateforme. Optionnel : `RECIPE_TRANSMIT_DAILY_LIMIT` (défaut 100).
4. Vérifications avec un vrai jeton (créé depuis l'app ou en SQL) :
   - `curl -i "https://<projet>.supabase.co/functions/v1/recipe-public?t=<token>"` : 200, `x-robots-tag: noindex`, aucun champ `notes`, `members`, `book_id`.
   - Jeton inventé ou révoqué : 404.
   - `recipe-transmit` avec le JWT d'un reader du carnet cible : 403 ; vers le carnet source : 400 ; sans JWT : 401.
5. Retour arrière : supprimer les deux fonctions ; `drop table public.recipe_public_links;` et `alter table public.recipes drop column transmitted_from;` ne touchent aucun objet de la cave.

## Points ouverts

- Les recettes en corbeille ne sont pas transmissibles (404) ; leur lien public renvoie 404 aussi, et redevient valide à la restauration.
- Les photos copiées par `recipe-transmit` ne sont pas nettoyées par `purge_recipe_trash()` (limite connue des fichiers Storage, cf. `recettes.sql`).
- Limitation par IP approximative (voir §1).
