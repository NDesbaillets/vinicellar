# ARÔMES V&N · Système visuel

Direction retenue le 19.11.2026 : « Le Livre », adaptée au logo le même jour. Maquette de référence : canevas « La Table V&N · Directions » (nom antérieur du projet), artboards B-Accueil et B-Fiche.

## Principes

1. **Gastronomie avant technologie.** La photo et le texte de la recette occupent l'écran. Pas d'icônes décoratives, pas de badges, pas de cartes ombrées.
2. **Élégance sans ostentation.** Filets fins, marges généreuses (32 px sur mobile), un seul ornement : le filet or de 40 px sous le logo et les titres de chapitre.
3. **Transmission familiale.** Les notes « En marge » et le statut « De famille » sont des fonctions de premier plan, pas des options cachées.

## Logo

Logo fourni le 19.11.2026 : `recettes/assets/logo-aromes-vn.svg` (fond transparent) et `logo-aromes-vn-fond.svg` (fond #FDFCFB). « ARÔMES » sur « V&N », capitales géométriques au trait fin, or #AA864F ; le circonflexe du Ô évoque une toque, un trait horizontal traverse le A, la jambe du R descend jusqu'à l'esperluette. Liseré tricolore sous le logo (#083476, blanc, #C91A27).

Ne pas redessiner le logo ni en modifier les couleurs. Taille minimale : 120 px de large. Le liseré tricolore n'apparaît que dans le logo, jamais comme motif d'interface.

Arbitrage du 19.11.2026 : l'interface suit le registre du logo (titres géométriques fins, or) et garde la mise en page du Livre (passe-partout, filets, planches) et un texte courant en Garamond.

## Couleurs

| Token | Valeur | Usage |
|---|---|---|
| `--fond` | `#FBF8F2` | fond |
| `--papier` | `#F3EDE2` | champs, passe-partout des photos |
| `--encre` | `#2A221E` | texte |
| `--encre-2` | `#4A3F37` | texte secondaire |
| `--encre-3` | `#6B5E52` | légendes, libellés |
| `--or` | `#AA864F` | couleur du logo : grands titres (24 px et plus), filets, icônes. Jamais pour du texte courant (contraste 3,3:1) |
| `--or-texte` | `#7E6033` | petits libellés dorés, quantités, liens, boutons pleins (texte `--fond` dessus) |
| `--or-fonce` | `#5E4624` | survol |
| `--filet` | `#DDD2C0` | filets, bordures |
| `--note` | `#F1E8D8` | encadré « Note avant de cuisiner » |

Le bleu et le rouge du liseré n'existent que dans le logo. Pas de mode sombre en V1.

## Typographie

- **Titres** : Jost 300, géométrique, en écho au logo. Titres de chapitre en capitales espacées (0,14-0,24 em) en `--or` ; titres de recettes en casse normale, `--encre`, 26-32 px.
- **Libellés** : Jost 400/500, 10-11 px, capitales, interlettrage 0,2-0,3 em.
- **Texte** : EB Garamond 400, 17 px, interligne 1,5, jamais en dessous de 15 px. Italique pour les sous-titres et les mentions de source.
- Google Fonts : `Jost:wght@300;400;500` et `EB+Garamond:ital,wght@0,400;0,500;1,400`.

## Composants

- **Logo** : `logo-aromes-vn-recadre.svg` (cadré serré) en tête de l'accueil, 240 px de large ; slogan « La curiosité se cuisine » dessous en libellé Jost.
- **Photo** : format 4:5, dans un passe-partout (12 px de `--papier`, filet `--filet`). Légende centrée « Planche N » + titre.
- **Ingrédients** : nom, points de conduite, quantité en `--or-texte`. Quantité inconnue en italique `--encre-3` (« q.b. », « non précisé »), jamais vide.
- **Étapes** : numéros arabes en Jost 300, 26 px, `--or` ; lisibles à un mètre.
- **Statut** : trois boutons (À essayer · Cuisinée · De famille), l'actif en `--or-texte` plein.
- **Alertes d'import** : encadré `--note` titré « Note avant de cuisiner », placé avant les ingrédients.
- **Boutons** : 48-52 px de haut, carrés, libellés Jost en capitales. Plein `--or-texte` pour l'action principale, filet `--or-texte` pour la secondaire.
- **Cibles tactiles** : 44 px minimum.
