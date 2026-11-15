# Refonte de l'interface · 6. Écrans retenus

15.11.2026. Décision : cave **C1** et fiche **F1 compactée** (voir `05-exploration.md`). La feuille Sortir est validée telle quelle. Maquette de référence : `06-ecrans.html` (publiée en page privée). Jetons : `04-systeme-visuel.md`. Pas de mode sombre.

## Structure commune

- **Une colonne** de 16 px de gouttière, au plus 430 px de large.
  - Sur iPad et ordinateur, la colonne reste centrée.
  - La grille passe à 3 colonnes au-delà de 600 px, puis à 4 au-delà de 900 px.
- **En-tête** : le mot « Vinicellar » en WindSong (lien vers la Cave) et la pastille du Compte à droite. Sur la fiche, il est remplacé par « ‹ Cave ».
- **Barre d'onglets** fixe de 53 px plus la zone de sécurité, quatre onglets : Cave, Sommelier, Ajouter (pastille bordeaux), Carnet.
- **Espacement entre blocs** : 12 px dans la fiche, 16 px dans la cave.
- **Blocs** : cartes `--card`, rayon 14, `--sh-1`. Seul l'en-tête de la fiche prend `--sh-2`.

## Cave (C1)

Ordre de lecture, de haut en bas :

1. **En-tête.**
2. **Sélecteur de cave** : contrôle segmenté « Toutes · <cave> · … », qui défile s'il y a plus de 3 caves. Le dernier choix est mémorisé.
3. **Recherche, filtres et bascule grille / liste** sur une ligne : champ de 40 px, deux boutons de 40 px.
4. **« À ouvrir en priorité »** : titre Fraunces 24 et nombre de vins à droite.
   - Rangée horizontale de cartes de 132 px de large, aimantées, débordant sur la gouttière.
   - Contenu : les vins « À boire vite », puis « À l'apogée ».
   - La rangée est masquée si elle est vide.
5. **« Sortir par photo »** : bouton secondaire en pleine largeur.
6. **« Toute la cave »** : titre et total de bouteilles à droite.
   - Grille de 2 colonnes, écart de 12 px.
   - Ordre par défaut : À boire vite → À l'apogée → Prête → Trop jeune → Garde inconnue ; puis par nom à statut égal.
   - Un tri choisi dans les filtres remplace cet ordre.

**Carte de grille :**
- vignette de 164 px de haut, drapeau de 22 px ;
- nom en Fraunces 20, sur 2 lignes au plus ;
- millésime et producteur (Inter 12) ;
- statut de garde ;
- en pied : quantité à gauche et « Sortir » à droite (pastille bordeaux claire de 32 px, zone de toucher portée à 44 px).

Toucher la carte, hors du bouton Sortir, ouvre la fiche. Pour un invité en lecture seule, Sortir est masqué.

**Liste** (bascule) : vignette de 52 × 72, nom en Fraunces 20, millésime, producteur et statut, quantité à droite. Le bouton Sortir est remplacé par un glissement vers la gauche, à valider pendant le lot Cave.

## Fiche (F1 compactée)

Critère vérifié : sur iPhone 13 (844 px), sans défiler, on voit la bouteille, le nom, le millésime, la note, le stock, Sortir et les 6 lignes du tableau.

1. **« ‹ Cave »** et la pastille du Compte.
2. **En-tête** (carte `--sh-2`, rembourrage de 12 px) :
   - à gauche, la vignette de 96 × 150 avec le drapeau de 22 px ;
   - à droite : producteur (Inter 12), nom (Fraunces 24), millésime (Fraunces 20, bordeaux), origine (Inter 12), puis ma note (étoiles, valeur, « ma note ») ou « Pas encore noté ».
   - Toucher la vignette ouvre la galerie (photos, aperçu, ajout de la bouteille entière).
3. **En cave** :
   - une ligne avec le total en Fraunces 24 suivi de « en cave », et « Sortir une bouteille » (bouton principal compact, 36 px de haut, zone de toucher de 44 px) ;
   - en dessous, une ligne par cave avec − et +, ou une seule ligne si le vin n'est que dans une cave.
   - Le − corrige le stock sans trace ; le message affiché le dit.
4. **Tableau** : les 6 lignes par défaut ou le choix fait dans le Compte. Libellé en `--ink-3`, valeur en `--ink`, Inter 14, lignes de 9 px de marge haute et basse.
5. **Garde** : frise à l'échelle (buvable, apogée, trait de l'année en cours), axe en 3 années, légende. Masquée si la garde est inconnue.
6. **Mes dégustations** : les 3 dernières (date, étoiles, accord, texte), avec un lien vers le Carnet s'il y en a plus. Masquées s'il n'y en a aucune.
7. **« Voir la fiche complète »** déplie sur place :
   - ma note et la moyenne en ligne côte à côte ;
   - description, vinification, terroir, accords, sources.

**iPhone SE (667 px)** : le tableau est coupé après 3 lignes. C'est accepté : la bouteille, le stock et Sortir restent visibles, et le défilement est court.

## Feuille « Sortir une bouteille »

Feuille du bas, rayon 14, poignée. Contenu, de haut en bas :

1. Vignette de 44 × 64, nom et millésime, cave et stock.
2. Choix Bue ou Offerte.
3. Choix de la cave, si le vin est dans plusieurs caves.
4. Ma note (5 étoiles de 44 px), si le vin a été bu.
5. Note facultative.
6. Date (aujourd'hui par défaut) ; « Offerte à » si le vin a été offert.
7. Annuler et Enregistrer.

Après l'enregistrement, un message confirme (« Bouteille bue · reste 2 ») et l'écran d'origine se met à jour.

## Accessibilité

- Zones de toucher de 44 px au moins.
- Contrastes AA, vérifiés à l'étape 4.
- Statut de garde : toujours du texte, jamais la couleur seule.
- Libellés explicites pour − et + (« Retirer une bouteille, Lausanne »).
- Frise avec un texte de remplacement complet.
- Animation de la feuille désactivée si l'utilisateur réduit les animations.
