# ARÔMES V&N · Invitations à un carnet

Edge function `invite-book-member` (`supabase/functions/invite-book-member/index.ts`). Cadrage : `01-cadrage.md` §1.

## Parcours

**Personne sans compte**
1. Le propriétaire saisit e-mail et rôle (membre ou lecteur) dans l'app.
2. La fonction vérifie qu'il est propriétaire du carnet, crée le compte (`inviteUserByEmail`) et envoie l'e-mail d'invitation (modèle ARÔMES V&N).
3. Le déclencheur crée le carnet personnel du nouveau compte ; la fonction l'ajoute en plus comme membre du carnet invitant, avec le rôle demandé, et inscrit l'invitation comme acceptée.
4. La personne clique le lien, arrive sur `/recettes/bienvenue.html`, choisit son mot de passe et trouve déjà le carnet partagé.

**Personne avec compte**
1. Même vérification ; `inviteUserByEmail` refuse l'adresse déjà inscrite (aucun e-mail ne part), ce qui sert de détecteur.
2. La fonction crée ou met à jour la ligne `recipe_book_invites` (rôle, `accepted_at` remis à null).
3. À sa prochaine ouverture, l'invitation apparaît dans l'app (`my_book_invites()`). Elle l'accepte (`accept_book_invite`) ou la refuse (`decline_book_invite`).

**Déjà membre** : réponse `already_member`, rien n'est écrit ni compté. Les membres du carnet sont comparés par e-mail (liste courte, pas de parcours de tous les utilisateurs).

## Contrat

`POST /functions/v1/invite-book-member`
En-tête `Authorization: Bearer <jwt utilisateur>`. Corps JSON :

```json
{ "book_id": "uuid", "email": "nom@exemple.ch", "role": "member" }
```

`role` : `member` (défaut) ou `reader`. Toute autre valeur, `owner` compris, est refusée. L'e-mail est mis en minuscules et validé.

Réponses 200 :

| Corps | Sens |
|---|---|
| `{ "result": "invited_new" }` | Compte créé, e-mail envoyé, ajouté directement au carnet |
| `{ "result": "pending" }` | Compte existant, invitation en attente dans l'app |
| `{ "result": "already_member" }` | Déjà membre (propriétaire compris) |

Erreurs : `{ "error": code, "message": "texte français" }`

| Statut | `error` | Cas |
|---|---|---|
| 400 | `invalid` | e-mail, rôle ou carnet invalide, JSON illisible |
| 401 | `auth` | JWT absent ou expiré |
| 403 | `forbidden` | l'appelant n'est pas propriétaire du carnet |
| 429 | `quota` | plus de 20 invitations en 24 h |
| 502 | `send_failed` | e-mail non parti ou invitation non enregistrée |

Limite : 20 invitations par propriétaire et par 24 h, comptées dans `public.ai_calls` avec `kind = 'book-invite'` (le nom de la table est historique). Une tentative qui échoue à l'envoi compte aussi.

## À faire dans le tableau de bord Supabase

1. **Déployer la fonction** `invite-book-member` (comme `invite-member` : réglage `verify_jwt` par défaut, aucune variable à ajouter ; `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournies par la plateforme).
2. **Modèle d'e-mail « Invite user »** (Authentication, Email Templates) : coller le contenu de `supabase/templates/invite.html`. Le modèle est commun au projet : quand `{{ .Data.app }}` vaut `aromes`, il affiche le texte ARÔMES V&N (invitant, nom du carnet, lien vers `/recettes/bienvenue.html`) ; sinon le texte Vinicellar actuel, inchangé. Tester l'envoi des deux cas (une demande d'accès Vinicellar, une invitation de carnet) : les invitations de cave n'envoient pas `app`, et le modèle doit alors retomber sur le texte Vinicellar sans erreur. Le sujet de l'e-mail se règle à part dans le même écran.
3. **Redirect URLs** (Authentication, URL Configuration) : ajouter `https://vinicellar.ch/recettes/bienvenue.html`.

## Garde-fous

- Seul un propriétaire du carnet passe (lecture `recipe_book_members` en service_role sur `book_id`, `user_id` du JWT, `role = 'owner'`). Le rôle `owner` ne peut ni être demandé ni être attribué.
- La clé service_role reste dans la fonction ; aucune réponse ni journal ne la contient.
- Nom de l'invitant et du carnet nettoyés (`< > { } & "`) avant l'e-mail.
