# ARÔMES V&N · Cadrage fonctionnel

Validé le 19.11.2026 par le propriétaire du projet, après un entretien de 41 questions. Ce document fait foi : toute décision qui s'en écarte lui est soumise.

## 1. Comptes et partage

- Base d'utilisateurs commune avec Vinicellar. Une personne invitée uniquement dans un carnet arrive sur ARÔMES V&N et ne voit pas Vinicellar tant qu'elle n'est pas membre d'une cave. L'invitation par un membre vaut accès, sans l'approbation admin de Vinicellar.
- **Carnets** (`recipe_books`) : même modèle que les collections Vinicellar (`supabase/sharing.sql`), mais indépendants des caves. Chaque utilisateur reçoit son carnet à l'inscription ; il peut inviter d'autres personnes et appartenir à plusieurs carnets (sélecteur « Tous / carnet »).
- **Rôles** : `owner` (tout, y compris gérer les membres), `member` (créer, modifier, supprimer des recettes), `reader` (consulter, annoter, enregistrer ses propres cuissons ; ne modifie ni recette, ni statut, ni couverture).
- **Notes** : partagées avec le carnet par défaut, option « privée » (visible de son seul auteur).
- **Transmettre** : copie d'une recette vers un autre carnet dont on est membre, sans les notes privées, avec lien vers l'original.
- **Lien public** : page en lecture seule, jeton non devinable, révocable, `noindex`. Image extraite du reel autorisée ; créateur toujours crédité avec lien vers la source.
- **Corbeille** : une recette supprimée reste 30 jours, restaurable par un propriétaire ou un membre (pas par un lecteur).

## 2. Import

- Sources : reel Instagram (lien), site de recettes (lien ; schema.org Recipe si présent, sinon extraction IA), saisie manuelle, photo de page imprimée ou **manuscrite**.
- Pipeline Instagram validé par test sur 10 reels le 19.11.2026 : Apify (légende + vidéo) → Gemini (parole, texte à l'écran, visuel) → Claude (fiche structurée). Aucune quantité inventée ; inconnue = vide avec précision.
- Une fiche importée entre au carnet en **« À vérifier »** avec ses alertes (contradictions entre sources, ingrédients non listés, quantités manquantes, matériel). Exception : la photo de page manuscrite exige une relecture avant d'entrer au carnet ; la photo de la page est conservée avec la fiche.
- **Langue** : fiche traduite en français, titre d'origine conservé quand c'est l'usage, version originale consultable.
- **Unités** : conversion en métrique à l'import (cups, oz, lb, °F, sticks), unité d'origine gardée en précision, alerte « Converti » quand la conversion dépend de la densité.
- **Catalogue d'ingrédients** commun : nom canonique, alias, rayon, mois de saison, saison courte, densité, allergènes. Chaque ligne de recette y est rattachée ; libellé d'origine conservé ; un ingrédient inconnu enrichit le catalogue après validation rapide.
- **Doublons** : proposés comme **versions** d'une même recette (onglet Versions, écarts affichés). Fusion possible, guidée : points communs repris, conflits arbitrés côte à côte, version absorbée archivée.
- **Vidéo** : conservée 30 jours puis supprimée ; l'image extraite (4:5) et le lien restent.
- **Limite** : 50 imports par personne et par 24 h (owner et member), comptés dans `ai_calls`.

## 3. Cuisiner

- **Journal des cuissons** : date, qui, note sur 5, commentaire, photo. Statut déduit : aucune cuisson = « À essayer », au moins une = « Cuisinée ». « De famille » est un choix explicite.
- **Portions** : demandées à la validation (préremplies si estimées). Ajustement des quantités avec arrondis (œufs et gousses à l'unité, épices à la demi-cuillère, « q.b. » inchangé).
- **Mode cuisine** : écran maintenu allumé, une étape à la fois en grand avec ses quantités, minuteurs détectés dans le texte, plusieurs simultanés, alerte sonore.
- **Couverture** : choisie à la main ; l'image d'origine reste dans la galerie.
- **Photo studio** : remise en scène d'une photo personnelle (détourage + fond studio, fal.ai comme `cutout`). Pour une recette sans aucune photo, illustration générée avec la mention discrète « illustration ». Jamais de retouche de l'image d'un créateur. À la demande, avec limite quotidienne.
- **Hors ligne** : planning de la semaine, recettes récentes, liste de courses ; synchronisation au retour du réseau.

## 4. Suggérer

- **Profil par personne** : allergies, aversions, régime, difficulté acceptée en semaine. Sélecteur « Pour qui ? » combinant les contraintes de plusieurs membres.
- **Saisons** : calendrier suisse des fruits et légumes, avec produits de saison courte (truffe blanche, morilles, asperges, gibier…).
- **Moteur** : poids fixes (saison, goûts issus du journal, variété, facilité), explication sur chaque suggestion, boutons « Pas cette fois » et « Jamais ».
- **Recherche** : texte tolérant aux fautes + filtres (carnet, statut, saison, durée, cuisine) ; « Avec ce que j'ai » (classement par ingrédients manquants) ; langage naturel traduit en filtres par Claude.

## 5. Organiser

- **Planning** par carnet : midi et/ou soir choisis à la main, jour par jour ; bouton « Reprendre le rythme de la semaine dernière » (jours et repas, sans les recettes) ; « Remplir ma semaine » propose des recettes à valider une à une ; nombre de convives par case.
- **Liste de courses** par carnet, partagée en temps réel, alimentée depuis une recette ou le planning ; fusion des quantités par ingrédient du catalogue ; classement par rayon ; articles libres.
- **Notifications** (app installée) : import terminé, recette ajoutée par un autre membre, invitation reçue. Pas de notification par article coché.

## 6. Transmettre

- Transmettre vers un autre carnet, lien public (voir §1).
- **Accord Vinicellar** : bouteilles des caves dont l'utilisateur est membre, via la fonction `sommelier` ; conseil général si aucune ne convient ; « Ouvrir cette bouteille » mène à la sortie Vinicellar.
- **Export** : JSON du carnet ; **livre PDF** au style du système visuel (couverture, chapitres, planches photo, notes en marge).

## 7. Forme

- PWA distincte sur `vinicellar.ch/recettes/` (manifest et service worker propres, scope `/recettes/`), connexion partagée avec Vinicellar.
- Système visuel : `docs/recettes/systeme-visuel.md`.

## 8. Livraison par phases

Chaque phase est utilisable avant de commencer la suivante, sur `/recettes/` non référencé.

1. **Fondations** : carnets, membres, invitations, rôles, catalogue d'ingrédients, saisie manuelle, fiche, recherche texte et filtres, corbeille.
2. **Import** : Instagram, lien web, photo de page (manuscrite comprise), conversions, doublons et versions.
3. **Cuisiner** : journal, mode cuisine et minuteurs, portions et ajustement, photos et studio, hors ligne.
4. **Suggérer** : profil, saisons, suggestions, « Avec ce que j'ai », recherche en langage naturel.
5. **Organiser** : planning, liste de courses partagée, notifications.
6. **Transmettre** : lien public, transmettre, accord Vinicellar, livre PDF, export.

## 9. Invités et réceptions (ajouté le 20.11.2026)

- **Invités** : fiches propres au carnet (nom, foyer facultatif, allergies parmi les 14 codes UE, régime, aversions, préférences et remarques libres, lien facultatif vers un compte existant). Visibles et modifiables par owner et member, visibles par les lecteurs. Jamais dans le lien public, le livre PDF ni l'export JSON par défaut (données de santé de tiers).
- **Réception** : date, créneau (midi, soir), invités, menu de plusieurs plats (entrée, plat, dessert…), note, photo. Se crée depuis le planning (case « invités ») ou après coup. Chaque plat servi s'inscrit dans le journal de la recette (« Cuisiné pour Marie, Paul »).
- **Fiche invité** : profil, historique des réceptions avec leurs menus, plats déjà servis.
- **Fiche recette** : dans l'historique, pour qui elle a déjà été cuisinée et quand.
- **Suggestions « Pour qui ? »** : les invités s'y choisissent comme les membres ; leurs contraintes s'appliquent ; les plats déjà servis à ces invités sont relégués en fin de liste avec la mention « Déjà servi à Marie le 12.03.2026 », un interrupteur permet de les masquer.
- **Vins servis** (plus tard) : lors d'une réception, vins choisis parmi les sorties de cave Vinicellar du jour, visibles sur la fiche invité. Le modèle prévoit la place dès maintenant.
