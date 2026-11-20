# ARÔMES V&N · Guide de mise en route

Pour le propriétaire du projet. Chaque étape dit **qui** la fait : **toi** (tableau de bord Supabase, comptes externes) ou **Claude** (depuis une session Claude Code, avec les outils Supabase). Fais les étapes dans l'ordre ; Claude vérifie chaque étape avant la suivante.

Tout le code est sur la branche `recettes`. Rien n'est visible sur vinicellar.ch tant que cette branche n'est pas fusionnée dans `main` (étape 9).

## 0. Ce qui est déjà en production

- Phase 1 (carnets, rôles, recettes, notes, photos, corbeille) : tables créées le 19.11.2026, un carnet par compte existant.
- Fonction `invite-book-member` déployée.

## 1. Réglages d'authentification · toi · 10 min

Supabase > projet « vinicellar » > **Authentication**.

1. **URL Configuration > Redirect URLs** : ajouter
   - `https://vinicellar.ch/recettes/bienvenue.html`
   - `https://vinicellar.ch/nouveau-mot-de-passe.html?next=/recettes/`
2. **Emails > Invite user** : remplacer le corps par le contenu de `supabase/templates/invite.html` (texte ARÔMES pour les invitations à un carnet, texte Vinicellar inchangé sinon).
3. **Emails > Reset password** : remplacer le corps par le contenu de `supabase/templates/recovery.html` (le lien ramène dans ARÔMES quand la demande vient d'ARÔMES).
4. **Sign In / Providers > Email** : activer **Leaked password protection** (inclus dans le plan Pro).

Claude te fournit le contenu exact des deux modèles à copier si tu ne veux pas ouvrir GitHub.

## 2. Clés des services externes · toi · 5 min

Supabase > **Edge Functions > Secrets** > Add new secret :

| Nom | Valeur | Remarque |
|---|---|---|
| `APIFY_TOKEN` | ton jeton Apify (console.apify.com > Settings > API & Integrations) | le jeton non restreint créé le 19.11 |
| `GEMINI_API_KEY` | ta clé Google AI Studio (projet « epicurious ») | projet en facturation payante |

`ANTHROPIC_API_KEY` et `FAL_KEY` existent déjà (utilisées par Vinicellar). Ne colle jamais une clé dans le chat.

## 3. Migrations de base · Claude · 5 min

Dans cet ordre, chacune testée au préalable sur PostgreSQL et rejouable sans risque :

1. `supabase/seed/catalogue-ingredients.sql` : 230 ingrédients (saisons suisses, densités, allergènes).
2. `supabase/recettes-phase2.sql` : suivi des imports, bucket des vidéos, temps réel.
3. `supabase/recettes-phase3.sql` : journal des cuissons, photos de cuisson.
4. `supabase/recettes-phase4.sql` : profils, suggestions, recherche.
5. `supabase/recettes-phase5.sql` : planning, courses, notifications (après la phase 2, pour le déclencheur de fin d'import).
6. `supabase/recettes-phase6.sql` : liens de partage public, recettes transmises.
7. `supabase/recettes-phase7.sql` : invités, réceptions, « déjà servi » (remplace la fonction de suggestions de la phase 4 : toujours l'appliquer après elle).

Claude vérifie ensuite les alertes de sécurité Supabase.

## 4. Fonctions serveur · Claude · 5 min

| Fonction | Rôle | Vérification de session |
|---|---|---|
| `recipe-import` | import Instagram, web, photo de page | oui |
| `recipe-studio` | photo studio, illustration (fal.ai) | oui |
| `recipe-search` | recherche en langage naturel | oui |
| `recipe-notify` | envoi des notifications | non (appelée par la base, protégée par un secret partagé) |
| `recipe-transmit` | transmettre une recette à un autre carnet | oui |
| `recipe-public` | page de partage public, sans compte | non (accès anonyme voulu, ne lit qu'une recette liée à un jeton valide) |

Variable conseillée : `RECIPE_IMPORT_MAX_SECONDS = 380` (plan Pro).

## 5. Notifications · Claude · 5 min

1. Claude génère les clés VAPID et le secret partagé et les enregistre directement comme secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NOTIFY_SECRET`) ; tu n'as rien à copier.
2. Claude crée le webhook de base de données (insertion dans `recipe_notifications_outbox` → `recipe-notify`), puis inscrit la clé publique dans le front.

## 6. Compte de test · décision à prendre

Pour tester le parcours réel (créer, importer, inviter, cuisiner), Claude propose de créer un compte temporaire `test-aromes@vinicellar.ch`, puis de le supprimer avec toutes ses données à la fin. Alternative : tu testes toi-même avec ton compte.

## 7. Tests réels · Claude, puis toi · 30 min

Sur un serveur local pointant vers la base réelle :

1. Phase 1 : créer une recette à la main avec photo, la chercher, la mettre à la corbeille, la restaurer.
2. Invitation : inviter une de tes adresses e-mail sans compte (vérifie la réception de l'e-mail ARÔMES et l'arrivée sur la page de bienvenue), puis un compte existant.
3. Import : un reel avec recette dans la légende, un reel sans (vidéo), une page web, une photo de page manuscrite.
4. Cuisiner : journal, portions, mode cuisine et minuteurs.
5. Suggestions, planning, liste de courses (à deux appareils pour le temps réel).
6. Invités : créer un invité avec une allergie, une réception, vérifier « Déjà servi » et les suggestions « Pour qui ? ».
7. Partage public, transmission, accord Vinicellar, livre PDF.

Claude te présente les résultats réels, y compris les échecs.

## 8. Relecture · toi · 15 min

Points à regarder en priorité :

- `assets/js/auth.js` : seul fichier de Vinicellar modifié (retour vers ARÔMES après « mot de passe oublié »).
- `docs/recettes/systeme-visuel.md` et les écrans sur téléphone.
- Les ingrédients douteux du catalogue : vacherin Mont-d'Or, féra et perche, châtaigne en fruit à coque.

## 9. Mise en ligne · Claude, sur ton feu vert

Fusion de `recettes` dans `main` : `vinicellar.ch/recettes/` devient accessible (référencé nulle part). Retour arrière possible en annulant le commit de fusion.

## Questions ouvertes à trancher

1. Un lecteur peut-il cocher la liste de courses (utile s'il fait les courses) ? Actuellement : non.
2. « Reprendre le rythme de la semaine dernière » recopie aussi le nombre de convives : à garder ?
3. Réception créée depuis le planning : le nombre de membres présents est déduit en retirant les invités du nombre de convives de la case. D'accord ?
4. Un menu passé compte comme « déjà servi » même si ses plats n'ont pas été inscrits au journal. D'accord ?
5. Livre PDF : les notes en marge affichent le prénom et le nom de leur auteur. À garder si le livre est offert ?
