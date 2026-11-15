# Refonte de l'interface · 8. Implémentation

Branche `refonte`, publiée sur `main` après validation.

## Lot 1 · Fondations (15.11.2026)

- Jetons de l'étape 4 dans `app.css` ; tailles, rayons et ombres ramenés aux jetons.
- Mode sombre retiré.
- Libellés de garde alignés.
- 45 sélecteurs CSS restent définis plusieurs fois : ils sont traités lot par lot.

## Lot 2 · Fiche (15.11.2026)

**Fiche F1 compactée** (`assets/js/fiche.js`) :
- En-tête : vignette et drapeau ; la pastille appareil photo ouvre la galerie (photos, vignette, aperçu).
- En cave :
  - total et « Sortir une bouteille » ;
  - une ligne par cave avec − et + ;
  - liens Autre cave, Déplacer, Envies ;
  - état « Plus en cave ».
- Tableau selon les préférences du Compte.
- Frise de garde à l'échelle.
- 3 dernières dégustations.
- « Voir la fiche complète » déplie, sur place :
  - les notes, ma note et la moyenne en ligne côte à côte ;
  - le récit, les accords, les prix et les détails ;
  - toutes les sorties ;
  - les sources et les actions.
- Sur téléphone, l'en-tête de l'app laisse la place à « ‹ Cave » et au compte.

**Feuille « Sortir une bouteille »** (`VC.takeOut`), partagée par la fiche, la cave, la page Sortir et le Sommelier :
- un seul écran : Bue / Offerte / Autre, cave si plusieurs, étoiles, plat, note, date ;
- la sortie n'est enregistrée qu'à « Enregistrer » ;
- un message permet de l'annuler.

**Annulation des corrections** : − et + affichent un message avec « Annuler ».

**Boutons** : l'action principale passe en bordeaux, en forme de pilule, dans toute l'app.

**Feuilles** : sur téléphone, elles s'ouvrent depuis le bas de l'écran.

**Données** (migration `refonte_provenance_preferences`, déjà appliquée) :
- `items.provenance` (acheté, cadeau, autre), `items.received_from`, `items.received_occasion`, saisis dans « Modifier la fiche » ;
- `profiles.fiche_rows` : lignes du tableau, réglées dans Compte › Tableau de la fiche ;
- `profiles.visual_bg` : le fond des aperçus suit le compte.

**Ancien CSS de la fiche supprimé** : `.sheet`, `.stock-list`, `.stepper`, `.timeline`, `.facts`, `.fact`, `.ageing`.

**Testé sur iPhone 13 simulé** :
- sortie bue avec note et plat, puis annulation : stock 2 → 1 → 2 ;
- correction − puis annulation : 2 → 1 → 2 ;
- préférences du tableau enregistrées et appliquées ;
- cave, Sortir et Sommelier ouverts sans erreur.

## Lot 3 · Cave (15.11.2026)

**La cave devient l'accueil de l'app** (`/app/`, `assets/js/cave.js`) :
- un bandeau Lavaux court, avec la salutation et le nom de la cave ;
- le sélecteur de cave (Toutes · chaque cave, dernier choix mémorisé) ;
- les invitations, les demandes à valider et les fiches prêtes ;
- la rangée « À ouvrir en priorité » : dépassée, puis à boire vite, puis à l'apogée ;
- « Sortir par photo » ;
- « Toute la cave », avec recherche, filtres et bascule grille / liste.

**Grille** : 2 colonnes sur téléphone, 3 puis 4 sur grand écran, rangée par statut de garde par défaut. Chaque carte montre la vignette et le drapeau, le nom sur 2 lignes, le millésime et le producteur, le statut, la quantité et « Sortir ».

**Liste** : vignette de 52 × 72, avec « Sortir » en bouton. Le glissement vers la gauche n'est pas fait.

**Page « Quelle cave ? »** : supprimée, avec `picker.js`.

**Ancienne adresse** : `app/cave.html` redirige vers `app/` en gardant `?loc=` (`go-cave.js`). Les liens internes pointent vers `/app/?loc=`.

**Retirés de l'accueil** : le grand bandeau photo avec ses boutons, la boîte de chiffres (total, à déguster, valeur) et la rangée des types. Le type reste dans les filtres. La valeur de la cave sera dans le Carnet › Bilan (lot 4).

**CSS** : 121 règles de l'ancienne cave et du sélecteur supprimées. Il reste 40 sélecteurs définis plusieurs fois.

**Versions** : toutes les pages chargent maintenant les mêmes versions de scripts et de styles (`20261115-r3`). `cave.html` chargeait encore un `core.js` ancien.

**Testé sur iPhone 13 simulé** :
- accueil, changement de cave, grille et liste ;
- Sortir depuis une carte, ouverture de la fiche et retour ;
- redirection de `cave.html`, recherche et filtres ;
- tous les tests du lot 2 repassés ; aucune erreur.
