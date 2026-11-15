# Refonte de l'interface · 4. Système visuel

15.11.2026. Suite de `03-architecture.md`. Spécimen à ouvrir sur iPhone : `04-specimen.html` (publié en page privée).

## Audit de `assets/css/app.css`

La feuille fait 835 lignes et 757 règles. Le désordre vient des ajouts successifs, pas de la palette.

| Mesure | Aujourd'hui | Cible |
|---|---|---|
| Couleurs | 63 hex distincts, 21 rgba, 40 variables | Tout passe par les jetons ci-dessous |
| Tailles de texte | 20 valeurs, dont des px bruts (9, 10, 11, 12, 16, 21) | 7 tailles |
| Espacements | 96 valeurs px distinctes | 7 pas sur une base de 4 |
| Rayons | 20 variantes | 3 |
| Ombres | 12 | 2 |
| Sélecteurs redéfinis | 63 (`.auth-card` ×3, etc.) | 0 : une règle par composant |
| Mode sombre | 8 blocs | Supprimés |
| `!important` | 5 | 0 |

## Couleurs

On garde la palette « Terroir contemporain », clair uniquement. Contrastes calculés selon WCAG 2.2.

| Jeton | Valeur | Usage | Contraste |
|---|---|---|---|
| `--bg` | #F7F5EF | Fond | |
| `--card` | #FFFFFF | Cartes, fiche, fond des aperçus par défaut | |
| `--sunk` | #ECEEE5 | Champs, segments, fond creux | |
| `--line` | #DDE2D4 | Séparateurs | |
| `--ink` | #262C25 | Texte | 13,1 sur fond |
| `--ink-2` | #535D50 | Texte secondaire | 6,3 sur fond ; 5,9 sur fond creux |
| `--ink-3` | #66705F | Légendes | 4,8 sur fond ; **4,4 sur fond creux : interdit** |
| `--wine` | #713D47 | Action principale, millésime, apogée | blanc dessus 8,5 |
| `--olive` | #67735F | Action secondaire | blanc dessus 5,0 |
| `--gold` | #A9824C | Étoiles uniquement | 3,2 : jamais pour du texte |
| `--gold-ink` | #83632F | Texte doré | 5,1 |

**Correction :** `--warn` passe de #9A6A12 (4,1 sur son fond, échec AA) à #7E560C (5,7).

## Statut de garde

Composant unique, utilisé dans la grille, la liste, la fiche et le Sommelier. Il affiche toujours une pastille et un texte, jamais la couleur seule.

| Statut | Texte | Fond | Contraste |
|---|---|---|---|
| Trop jeune | #4C5F86 | #E5E9F2 | 5,3 |
| Prête | #2F6E4F | #E3F0E8 | 5,2 |
| À l'apogée | #713D47 | #F0E5E7 | 6,9 |
| À boire vite | #7E560C | #F8EED8 | 5,7 |
| Dépassée | #9A3B2F | #F6E1DC | 5,5 |
| Garde inconnue | #5E6470 | #ECEDEF | 5,1 |

Le calcul reste celui du Sommelier (`status()` dans `supabase/functions/sommelier/index.ts`), à partager côté client.

## Typographie

- **Wordmark** : WindSong, inchangé.
- **Interface** : Inter.
- **Titres** (noms de vin, millésimes, nombres de bouteilles) : **Fraunces, conservée** (décision du 15.11.2026). Cormorant Garamond, Bodoni Moda et Jost ont été comparées dans le spécimen puis écartées.
- Fraunces est utilisée en graisse 500, avec l'axe optique automatique (`font-optical-sizing: auto`) et les chiffres alignés (`lining-nums`).
- Inter reste seule sous 20 px.

**Échelle** (rem sur une base de 16) :

| Taille | Usage |
|---|---|
| 12 | Légendes, axes |
| 14 | Tableau, métadonnées |
| 16 | Texte courant, champs, boutons |
| 20 | Nom de vin dans la grille et la liste |
| 24 | Millésime, stock |
| 32 | Nom de vin dans la fiche |
| 40 | Titre de page |

## Espacement, rayons, ombres

- **Espacement** : 4 · 8 · 12 · 16 · 24 · 32 · 48. La gouttière latérale fait 16 px.
- **Rayons** : 8 pour les champs, segments et vignettes en liste ; 14 pour les cartes, la fiche et les feuilles ; pilule pour les boutons et les statuts.
- **Ombres** :
  - `--sh-1` : cartes posées ;
  - `--sh-2` : fiche et feuilles.
- **Zones de toucher** : 44 px au minimum. Les boutons + et − font 44 px, le bouton principal 48 px.

## Composants

1. **Vignette de bouteille**, en trois tailles :
   - fiche : 132 × 200 ;
   - grille : pleine largeur × 168 ;
   - liste : 52 × 72.

   Fond `--visual-bg`, drapeau rond dans le coin supérieur gauche (26, 22 et 14 px selon la taille).
2. **En-tête de fiche** : vignette, producteur, nom, millésime en bordeaux, origine, ma note.
3. **Bloc « En cave »** : total, une ligne par cave avec − et +, puis « Sortir une bouteille ».
4. **Tableau de faits** : libellé et valeur, 6 lignes par défaut.
5. **Frise de garde** : période buvable, apogée et année en cours, tracées à l'échelle.
6. **Statut de garde** (ci-dessus).
7. **Boutons** : principal (bordeaux plein), secondaire (contour bordeaux), discret (texte), pas à pas (rond de 44 px).
8. **Carte de grille** et **ligne de liste**.
9. **Feuille** (sheet) : rayon 14 en haut, `--sh-2`.
10. **Contrôle segmenté** : sélecteur de cave et sections du Carnet.

## Décisions

- Typographie des titres : Fraunces, conservée.
- Jetons de couleur, d'espacement, de rayon et d'ombre : pas d'objection. Ils sont repris tels quels à l'étape 5.
