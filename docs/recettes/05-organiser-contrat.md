# ARÔMES V&N · Phase 5 « Organiser » : contrat base et serveur

Pour le développement front (`recettes/`). Source de vérité : `supabase/recettes-phase5.sql` (à appliquer après `recettes.sql`, `recettes-phase2.sql`, `recettes-phase3.sql`) et `supabase/functions/recipe-notify/index.ts`. Cadrage : `01-cadrage.md` §5. Arrondis : `03-cuisiner-contrat.md` §5.

Rôles : lecture par tout membre du carnet ; écriture par les éditeurs (`owner`, `member`). Le `reader` consulte seulement (voir point ouvert 1). `anon` : aucun droit.

## 1. Planning : `recipe_meal_plan`

| Colonne | Type | Remarque |
|---|---|---|
| `id` | uuid | peut être fourni par le client (rejeu hors ligne) |
| `book_id` | uuid | carnet |
| `day` | date | afficher en JJ.MM.AAAA |
| `slot` | text | `'midi'` ou `'soir'` |
| `state` | text | `'prevu'` (défaut), `'dehors'`, `'travail'`, `'invites'` |
| `recipe_id` | uuid null | recette du même carnet (sinon erreur) ; mise à null si la recette est supprimée définitivement |
| `servings` | int null | convives, > 0 |
| `note` | text null | 500 caractères au plus |
| `created_by` | uuid | doit être `auth.uid()` à l'insertion |
| `updated_at` | timestamptz | posé par le serveur |

Unicité `(book_id, day, slot)` : une case par jour et créneau. Écrire une case avec `upsert(..., { onConflict: 'book_id,day,slot' })` exige les droits d'insertion et de mise à jour (éditeur) ; les colonnes modifiables sont `day, slot, state, recipe_id, servings, note`. Supprimer la ligne = case vide.

```js
await sb.from('recipe_meal_plan').upsert(
  { book_id, day: '2026-11-23', slot: 'soir', state: 'prevu', recipe_id, servings: 4, created_by: user.id },
  { onConflict: 'book_id,day,slot' })
const { data } = await sb.from('recipe_meal_plan').select('*').eq('book_id', book_id).gte('day', lundi).lte('day', dimanche)
```

### `recipe_plan_copy_rhythm(p_book uuid, p_from_week date, p_to_week date) → int`

« Reprendre le rythme de la semaine dernière ». Les deux dates peuvent être n'importe quel jour de leur semaine (ramenées au lundi). Recopie jour, créneau, **état et convives**, sans recette ni note. Ne remplace jamais une case déjà présente dans la semaine cible. Renvoie le nombre de cases créées. Erreur `42501` si l'appelant n'est pas éditeur ; erreur si les deux semaines sont la même.

```js
const { data: n } = await sb.rpc('recipe_plan_copy_rhythm', { p_book: book_id, p_from_week: '2026-11-16', p_to_week: '2026-11-23' })
```

« Remplir ma semaine » reste côté client (suggestions validées une à une, puis `upsert` ci-dessus).

## 2. Liste de courses : `recipe_shopping_items`

| Colonne | Type | Remarque |
|---|---|---|
| `id` | uuid | |
| `book_id` | uuid | |
| `catalog_id` | uuid null | ingrédient du catalogue ; null pour un article libre |
| `label` | text | nom affiché (nom du catalogue, ou libellé libre) |
| `quantity` | numeric null | null = « q.b. » / sans quantité |
| `unit` | text null | mêmes valeurs que `recipe_ingredient_lines.unit` : `g kg ml cl l cas cac piece pincee botte gousse tranche` |
| `aisle` | text | mêmes rayons que le catalogue : `fruits_legumes boucherie poissonnerie cremerie epicerie epices boulangerie surgeles boissons autre` (défaut `autre`) |
| `checked` | bool | |
| `checked_by`, `checked_at` | | posés par le serveur au cochage, remis à null au décochage (non modifiables par le client) |
| `added_by` | uuid | doit être `auth.uid()` à l'insertion |
| `source_recipe_id`, `source_plan_id` | uuid null | origine de la ligne créée par les fonctions ci-dessous |
| `created_at` | timestamptz | |

Colonnes à l'insertion : `id, book_id, catalog_id, label, quantity, unit, aisle, checked, added_by`. À la mise à jour : `catalog_id, label, quantity, unit, aisle, checked`. Article libre : `insert({ book_id, label, aisle, added_by: user.id })`. Classement par rayon : trier côté client sur `aisle` (ordre d'affichage au choix du front) puis `label`. Vider les articles cochés : `delete().eq('book_id', b).eq('checked', true)`.

### `recipe_shopping_add_recipe(p_book uuid, p_recipe uuid, p_servings int default null) → jsonb`

Ajoute les ingrédients d'une recette (qui doit appartenir au carnet, hors corbeille). Renvoie `{ "added": n, "merged": n, "skipped": n }`.

- **Échelle** : facteur = `p_servings / recipes.servings` (1 si l'un des deux est inconnu) ; arrondis de `03-cuisiner-contrat.md` §5. Écart : une cuillère qui arrondirait à zéro devient 0,5 (pas de « pointe » sur une liste).
- **Exclus** : lignes `optional`, sel (fin, gros, fleur de sel), poivre, eau (reconnus par nom du catalogue, alias ou libellé d'origine).
- **Fusion** avec les articles **non cochés** du carnet, même ingrédient (`catalog_id`, ou libellé identique si hors catalogue) :
  - g et kg, ou ml, cl et l : convertis puis additionnés. 200 g + 300 g = 500 g ; 1 kg + 250 g = 1,25 kg ; dès 1000 g (ml) le résultat passe en kg (l) ; deux quantités en cl restent en cl.
  - autre unité : additionnée seulement si l'unité est la même ; sinon **ligne séparée** (ex. farine 250 g et farine 2 cas).
  - pincée : jamais additionnée (« une pincée » reste une pincée).
  - quantité vide (« q.b. ») : rien n'est ajouté si l'ingrédient est déjà sur la liste ; une ligne q.b. existante reçoit la quantité d'une ligne chiffrée qui arrive ensuite.
  - un article coché n'est jamais fusionné (on le rachète : nouvelle ligne).
- `42501` si l'appelant n'est pas éditeur.

### `recipe_shopping_add_plan(p_book uuid, p_from date, p_to date) → jsonb`

Ajoute toutes les recettes planifiées de la période (bornes incluses, 31 jours au plus), chacune pour les convives de sa case (à défaut, ses portions). Les cases sans recette sont ignorées ; une recette en corbeille aussi. Renvoie `{ added, merged, skipped, recipes }`. Les lignes créées portent `source_plan_id`.

## 3. Temps réel

`recipe_shopping_items` et `recipe_meal_plan` sont dans la publication `supabase_realtime`. Les événements respectent la RLS : un membre ne reçoit que les lignes de ses carnets.

```js
sb.channel('courses-' + book_id)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'recipe_shopping_items', filter: `book_id=eq.${book_id}` }, onChange)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'recipe_meal_plan', filter: `book_id=eq.${book_id}` }, onChange)
  .subscribe()
```

Un événement `DELETE` ne contient que la clé primaire (`old.id`) : retirer l'article de la liste locale par `id`. Hors ligne : mettre en file les écritures et les rejouer au retour du réseau avec des `id` générés côté client (insertions idempotentes via `upsert` sur `id`).

## 4. Notifications push

Aucune notification par article coché. Trois sortes :

| `kind` | Déclencheur | Destinataire | Titre / texte |
|---|---|---|---|
| `import_termine` | `recipe_imports.status` passe à `termine` ou `a_relire` (une fois) | l'auteur de l'import | « Import terminé » / « Votre recette est prête dans le carnet. » ; pour `a_relire` : « Import à relire » / « Une fiche attend votre relecture avant d'entrer au carnet. » |
| `recette_ajoutee` | insertion d'une recette (hors corbeille) avec un `created_by` | les autres membres du carnet, lecteurs compris | « Nouvelle recette » / « « Titre » a été ajoutée au carnet « Nom ». » |
| `invitation` | invitation en attente pour une adresse qui a déjà un compte | ce compte | « Invitation à un carnet » / « Vous êtes invité(e) au carnet « Nom ». » |

Le déclencheur d'import n'existe que si `recipe_imports` existe au moment d'appliquer le fichier. Les textes sont composés par `recipe-notify` (titre de recette et nom de carnet seulement, nettoyés ; ni e-mail, ni note, ni quantité).

### Tables

- `recipe_push_subscriptions` : `user_id`, `endpoint` (unique), `p256dh`, `auth`. Chacun lit et supprime les siennes. **Pas d'insertion directe** : passer par `recipe_push_subscribe(p_endpoint, p_p256dh, p_auth)` (rattache l'endpoint au compte connecté, même si le navigateur était lié à un autre compte).
- `recipe_notifications_outbox` : aucun accès client (la RLS refuse tout). Alimentée par triggers, vidée par `recipe-notify`.

### Abonnement côté navigateur

Clé VAPID **publique** (dans le front, pas un secret) : `VAPID_PUBLIC_KEY` générée à l'étape 1 du déploiement. L'app doit être installée (sur iPhone : « Sur l'écran d'accueil », iOS 16.4 ou plus), et l'utilisateur doit accepter, **sur un geste** (bouton « Activer les notifications »).

```js
const VAPID_PUBLIC = '<clé publique base64url>'
const b64 = (s) => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

async function activerNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'non_supporte'
  if (await Notification.requestPermission() !== 'granted') return 'refuse'
  const reg = await navigator.serviceWorker.ready                       // sw.js, portée /recettes/
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC) })
  const j = sub.toJSON()
  const { error } = await sb.rpc('recipe_push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth })
  return error ? 'erreur' : 'ok'
}
async function desactiverNotifications() {
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
  if (!sub) return
  await sb.from('recipe_push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}
```

À rappeler la fonction d'abonnement à chaque connexion (idempotent) pour garder l'endpoint rattaché au bon compte. Gestionnaire à ajouter à `recettes/sw.js` (le corps reçu est `{ title, body, url, tag, kind, icon }`) :

```js
self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(d.title || 'ARÔMES V&N', { body: d.body, tag: d.tag, icon: d.icon, data: { url: d.url || '/recettes/' } }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(clients.openWindow(e.notification.data.url))
})
```

## 5. Edge function `recipe-notify`

Appel serveur seulement : `POST /functions/v1/recipe-notify`, sans corps utile. Authentification : en-tête `x-notify-secret: <NOTIFY_SECRET>` (16 caractères au moins), ou `Authorization: Bearer <service_role>`. Sinon `401`. Pas de CORS, pas d'appel utilisateur. Elle réserve jusqu'à 50 notifications en attente (`recipe_outbox_claim`, sans double envoi entre deux exécutions simultanées), envoie le push à chaque appareil de la personne (TTL 24 h), supprime les abonnements expirés (HTTP 404/410), puis renseigne `sent_at`. Sans abonnement : notification close (`last_error = 'aucun abonnement'`). Échec temporaire : nouvelle tentative au passage suivant, 5 au plus, dans les 24 h. Réponse : `{ claimed, sent, no_subscription, failed, expired_removed }` ; `503 not_configured` si un secret VAPID manque.

## 6. Déploiement pas à pas (propriétaire)

1. **Clés VAPID** : `npx web-push generate-vapid-keys`. Noter la clé publique (pour le front) et la clé privée.
2. **Secret partagé** : générer une valeur aléatoire, par exemple `openssl rand -hex 24`.
3. **Secrets de la fonction** : `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:<adresse de contact> NOTIFY_SECRET=… --project-ref <réf>` (ou Edge Functions > Secrets). `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis par la plateforme.
4. **Base** : relire puis exécuter `supabase/recettes-phase5.sql` dans le SQL Editor (rejouable). Vérifier que `recettes-phase2.sql` est déjà appliqué (message `NOTICE … recipe_imports absente` sinon : le rejouer après). Contrôles :
   - `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('recipe_shopping_items','recipe_meal_plan');` (2 lignes)
   - `select tgname from pg_trigger where tgname like 'recipe_notify%';` (3 lignes)
   - `select relrowsecurity from pg_class where relname in ('recipe_meal_plan','recipe_shopping_items','recipe_push_subscriptions','recipe_notifications_outbox');` (4 fois `true`)
5. **Fonction** : `supabase functions deploy recipe-notify --no-verify-jwt --project-ref <réf>`. Ici, et ici seulement, la vérification JWT de la plateforme est désactivée : le webhook n'envoie pas de JWT utilisateur, et la fonction refuse tout appel sans `x-notify-secret` ou clé service_role.
6. **Déclencheur d'envoi : webhook de base de données (recommandé).**
   Dashboard > Database > Webhooks > Create a new hook : nom `recipe-notify`, table `recipe_notifications_outbox`, événement **Insert**, type **Supabase Edge Functions** (ou HTTP Request), URL `https://<réf>.supabase.co/functions/v1/recipe-notify`, méthode `POST`, en-tête ajouté `x-notify-secret` = valeur de `NOTIFY_SECRET`, délai 5000 ms. Envoi immédiat à chaque notification. Une notification dont l'envoi échoue est reprise au prochain insert dans l'outbox (le webhook traite tout ce qui attend).
   *Variante pg_cron* (envoi toutes les minutes, utile en filet de sécurité ou si les webhooks ne sont pas souhaités) : activer `pg_cron` et `pg_net` (Database > Extensions), stocker le secret dans le Vault (`select vault.create_secret('<NOTIFY_SECRET>', 'notify_secret');`), puis :
   ```sql
   select cron.schedule('recipe-notify', '* * * * *', $$
     select net.http_post(
       url := 'https://<réf>.supabase.co/functions/v1/recipe-notify',
       headers := jsonb_build_object('Content-Type', 'application/json',
         'x-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')),
       body := '{}'::jsonb) $$);
   ```
   Recommandation : le webhook, pour l'immédiateté et l'absence de passage à vide ; ajouter le cron seulement si des envois restent bloqués. Nettoyage facultatif : `select cron.schedule('recipe-outbox-purge', '15 3 * * *', 'select public.recipe_outbox_purge()');`.
7. **Front** : mettre la clé publique dans le code d'abonnement (§4), ajouter les gestionnaires `push` et `notificationclick` à `recettes/sw.js`.
8. **Vérification de bout en bout** (deux comptes, un éditeur et un lecteur, sur un appareil avec l'app installée) :
   - le lecteur active les notifications ; l'éditeur ajoute une recette : le lecteur reçoit « Nouvelle recette », l'éditeur ne reçoit rien ;
   - `select kind, sent_at, attempts, last_error from recipe_notifications_outbox order by id desc limit 5;` (`sent_at` renseigné) ;
   - courses : l'éditeur ajoute une recette de 200 g de beurre puis une de 300 g : une seule ligne « Beurre 500 g » ; le lecteur la voit apparaître en direct et ne peut pas la cocher ;
   - désinstaller l'app sur l'appareil, provoquer une notification : l'abonnement disparaît de `recipe_push_subscriptions` (réponse 404/410).
9. Ne fusionner vers `main` qu'après ces contrôles (la fusion publie le site).

## 7. Points ouverts

1. **Cocher en magasin par un lecteur** : décision prise (éditeurs seulement), mais un `reader` qui fait les courses ne peut pas cocher. Le cadrage ne tranche pas ; à confirmer par le propriétaire. Si oui : une policy `update` ouverte aux membres plus un trigger qui n'autorise alors que `checked`.
2. **Icône de notification** : seul un logo SVG existe ; certains systèmes exigent un PNG. Prévoir un `icon-192.png` et ajuster `recipe-notify`.
3. **Convives recopiés** par `recipe_plan_copy_rhythm` (le cadrage dit « jours et repas ») : choix à confirmer.
4. **Préférences** : pas de réglage par type de notification ; un utilisateur abonné reçoit les trois sortes.
