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

## Lot 4 · Navigation (15.11.2026)

**Barre du bas**, 4 onglets : Cave · Sommelier · Ajouter · Carnet.
- L'onglet Sortir disparaît : « Sortir par photo » part de la Cave, et la page Sortir s'y rattache.
- Ajouter est une pastille bordeaux avec son libellé.
- Sur ordinateur, l'en-tête montre Cave · Sommelier · Carnet · Compte · Ajouter.

**Carnet** : un sélecteur en haut de chaque section, dans l'ordre Dégustations · Vins passés · Envies · Bilan. Chaque section a son propre titre.

**Bilan** : nouveau bloc « En cave aujourd'hui » (bouteilles, à déguster maintenant, valeur estimée), repris de l'ancien accueil.

**Studio retiré** : `app/studio.html` (qui redirige maintenant vers l'accueil), `studio.js`, `studio-page.js`, son test et sa documentation. Les appels restants sont protégés (`VC.Studio?.`) et ne font rien.

**Tests** :
- `tests/core.test.cjs` : test du thème remplacé par celui du mode sombre retiré, ajout d'un test du tableau de la fiche et du drapeau. 7 sur 7.
- Navigation testée sur iPhone 13 simulé et sur ordinateur : onglet actif sur chaque page, les quatre sections du Carnet, redirections. Aucune erreur.

## Retouches (15.11.2026)

**Studio supprimé du dépôt** : le worker, les fonctions `studio-start` et `studio-review`, la proposition SQL, le script et les fixtures d'aperçu. Les derniers appels côté client sont retirés, ainsi que le CSS. Rien n'avait été déployé : ni tables, ni buckets, ni fonctions.

**Fonction `visual`** : toujours déployée mais plus appelée depuis le passage au détourage fal.ai. Elle est à supprimer dans le tableau de bord Supabase.

**Photos** : les deux photos de Lavaux sous licence CC BY-SA et le prototype `previews/chai` sont remplacés par trois photos personnelles. Elles sont redimensionnées et leurs métadonnées EXIF retirées.
- Accueil public : le lac et les Alpes.
- Cave : les terrasses d'Épesses.
- Sommelier : une grappe.

La page `credits.html` devient « Photographies ».

**Vignettes de la cave** : bouteille plus grande (212 px, 236 px sur grand écran), image entière sans recadrage. La zone de texte est réduite : nom sur 2 lignes en 16 px, millésime et statut sur une ligne, quantité et Sortir.

**Marque** : le verre, le mot et l'abeille prennent le bordeaux du bouton Ajouter (`--logo: var(--wine)`).

**Abeille** :
- elle arrive par la gauche, fait le tour du pied du verre et souligne le mot ;
- elle traverse le bandeau en vague avec deux loopings, placés avant le menu ;
- elle passe derrière le menu, le bouton Ajouter et le compte, puis sort à droite ;
- elle réapparaît aussitôt posée au bout du mot, avec trois étincelles.
