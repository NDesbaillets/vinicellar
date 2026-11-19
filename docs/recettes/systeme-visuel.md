# ARÔMES V&N · Système visuel

Direction retenue le 19.11.2026 : « Le Livre ». Maquette de référence : canevas « La Table V&N · Directions » (nom antérieur du projet), artboards B-Accueil et B-Fiche.

## Principes

1. **Gastronomie avant technologie.** La photo et le texte de la recette occupent l'écran. Pas d'icônes décoratives, pas de badges, pas de cartes ombrées.
2. **Élégance sans ostentation.** Filets fins, marges généreuses (32 px sur mobile), un seul ornement : le filet or de 40 px sous le logo et les titres de chapitre.
3. **Transmission familiale.** Les notes « En marge » et le statut « De famille » sont des fonctions de premier plan, pas des options cachées.

## Logo

Logo fourni le 19.11.2026 : `recettes/assets/logo-aromes-vn.svg` (fond transparent) et `logo-aromes-vn-fond.svg` (fond #FDFCFB). « ARÔMES » sur « V&N », capitales géométriques au trait fin, or #AA864F ; le circonflexe du Ô évoque une toque, un trait horizontal traverse le A, la jambe du R descend jusqu'à l'esperluette. Liseré tricolore sous le logo (#083476, blanc, #C91A27).

Ne pas redessiner le logo ni en modifier les couleurs. Taille minimale : 120 px de large. Le liseré tricolore n'apparaît que dans le logo, jamais comme motif d'interface.

À arbitrer : le logo est géométrique et sans empattements, la direction « Le Livre » est classique et à empattements. Les sections Couleurs et Typographie ci-dessous restent valables tant que l'arbitrage n'est pas fait.

## Couleurs

| Token | Valeur | Usage |
|---|---|---|
| `--papier` | `#F2EBDD` | fond |
| `--papier-clair` | `#F7F2E8` | champs, passe-partout des photos |
| `--encre` | `#2A221E` | texte |
| `--encre-2` | `#4A3F37` | texte secondaire |
| `--encre-3` | `#6B5E52` | légendes, libellés (contraste 5,2:1 sur papier) |
| `--bordeaux` | `#5C1A28` | accent, quantités, boutons pleins |
| `--bordeaux-fonce` | `#3E0F1A` | survol |
| `--filet` | `#CDBFA8` | filets, bordures |
| `--or` | `#9A7B4F` | filet ornemental uniquement, jamais pour du texte |
| `--note` | `#EADFCB` | encadré « Note avant de cuisiner » |

Pas de mode sombre en V1.

## Typographie

- **Titres** : Cormorant Garamond 400/500, romain ou italique. Accueil chapitre 56 px, titre de fiche 40 px, titres de section 26-28 px en italique encadrés de filets.
- **Texte** : EB Garamond 400, 17 px, interligne 1,5. Jamais en dessous de 15 px.
- **Libellés** : EB Garamond en petites capitales (`font-variant: small-caps; text-transform: lowercase`), interlettrage 0,12-0,2 em.
- Google Fonts : `Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500` et `EB+Garamond:ital,wght@0,400;0,500;1,400`.

## Composants

- **Photo** : format 4:5, dans un passe-partout (12 px de `--papier-clair`, filet `--filet`). Légende centrée « Planche N » + titre.
- **Ingrédients** : nom, points de conduite, quantité en bordeaux. Quantité inconnue en italique `--encre-3` (« q.b. », « non précisé »), jamais vide.
- **Étapes** : chiffres romains en Cormorant bordeaux. Pour le mode cuisine, prévoir une variante à grands numéros arabes (reprise de la direction A).
- **Statut** : trois boutons (À essayer · Cuisinée · De famille), l'actif en bordeaux plein.
- **Alertes d'import** : encadré `--note` titré « Note avant de cuisiner », placé avant les ingrédients.
- **Boutons** : 48-52 px de haut, carrés, petites capitales. Plein bordeaux pour l'action principale, filet bordeaux pour la secondaire.
- **Cibles tactiles** : 44 px minimum.
