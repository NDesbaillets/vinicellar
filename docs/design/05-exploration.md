# Refonte de l'interface · 5. Exploration des options

15.11.2026. Maquettes cliquables : `05-maquettes.html` (publiée en page privée). Les jetons viennent de l'étape 4 (Fraunces, Inter, palette actuelle). Les silhouettes de bouteilles remplacent les aperçus réels, qui sont privés.

## Ce qu'on doit trancher, et sur quels critères

Les critères ont été fixés avant les maquettes, à partir du cadrage :

1. La fiche montre l'essentiel sans défiler : bouteille, nom, millésime, note, stock et tableau.
2. Trouver une bouteille à ouvrir prend au plus 3 gestes depuis l'ouverture de l'app.
3. Sortir et noter une bouteille prend au plus 2 gestes.
4. Viviane s'en sert sans aide.
5. Tous les écrans utilisent les mêmes composants.

## Cave

| | C1 · Rangée + grille | C2 · Par statut | C3 · Mur |
|---|---|---|---|
| Principe | Rangée « À ouvrir en priorité » en tête, puis toute la cave en grille de 2 colonnes | Grille de 2 colonnes découpée en sections par statut (À boire vite → Trop jeune) | 3 colonnes ; bouteille, pastille de statut et nombre seulement |
| Bouteille à ouvrir | 1 geste : elle est dans la rangée, visible à l'ouverture | 1 geste : première section | 1 geste, mais le statut n'est qu'un point coloré |
| Sortir | 1 geste depuis la carte, plus la feuille : 2 | 2 | 3 : passage obligé par la fiche |
| Vins visibles sans défiler | 3 dans la rangée | 2 | 6 |
| Limites | Les vins prioritaires apparaissent deux fois (rangée et grille) | Section « Trop jeune » en bas ; une cave de 44 vins devient une longue liste par statut | Lecture par la couleur ; noms tronqués ; recherche indispensable |

**Recommandation : C1**, conforme au cadrage, en reprenant de C2 l'ordre de la grille par statut quand aucun tri n'est choisi.

C3 reste à garder en tête pour plus tard, si la cave dépasse environ 150 références : il pourrait alors devenir une option de la bascule d'affichage.

## Fiche

| | F1 · Défilante | F2 · Scène | F3 · Onglets |
|---|---|---|---|
| Principe | En-tête côte à côte (bouteille et texte), En cave, tableau, garde, dégustations, fiche complète dépliée sur place | Grande bouteille centrée façon Vivino ; stock et « Sortir » dans une barre fixe au-dessus des onglets | En-tête compact et stock, puis trois onglets : Essentiel · Garde et notes · Fiche complète |
| Essentiel sans défiler (iPhone 13, 2 caves) | Non : le tableau est coupé après 3 lignes | Non : seuls la bouteille, le nom et le stock sont visibles ; la note et le tableau sont sous le pli | Presque : 5 lignes sur 6 (toutes avec une seule cave) |
| Sortir | 1 geste, si le bouton est à l'écran | 1 geste, toujours à portée de pouce | 1 geste |
| Garde et dégustations | Visibles en défilant | Visibles en défilant | 1 geste de plus (onglet) : contraire au cadrage, qui les veut « toujours visibles » |
| Effet « fiche de cave » | Bon | Le plus fort | Le plus faible : ressemble à un formulaire |

Aucune variante ne passe le critère 1 telle quelle.

**Recommandation : F1 compactée**, qui reprend deux éléments de F3 :
- l'en-tête compact de F3 : vignette de 96 px au lieu de 128 px et nom en 24 px ;
- la ligne de stock de F3 : « 3 en cave » et « Sortir » sur une seule ligne, avec les lignes par cave seulement s'il y en a plusieurs.

Le gain est d'environ 150 px : le tableau entier tient à l'écran, et la garde et les dégustations restent visibles en défilant. La grande bouteille de F2 reste accessible en touchant la vignette, qui ouvre la galerie en plein écran.

## Feuille « Sortir une bouteille » (commune)

- Choix Bue ou Offerte.
- Choix de la cave seulement si le vin est dans plusieurs caves.
- Étoiles si le vin a été bu ; « Offerte à » s'il a été offert.
- Note facultative et date du jour.
- Enregistrer.

Il faut 2 gestes depuis la grille, ou 3 si on note. Le − de la fiche corrige le stock sans rien inscrire dans le carnet ; le message affiché le dit.

## Décision attendue

1. La cave : C1, avec la grille ordonnée par statut ?
2. La fiche : F1 compactée, ou une autre variante ?
3. La feuille Sortir : la valider telle quelle ?
