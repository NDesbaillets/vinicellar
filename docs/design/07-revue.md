# Refonte de l'interface · 7. Revue critique, accessibilité, conventions iPhone

15.11.2026. Écrans revus : la cave C1 et la fiche F1 compactée (`06-ecrans.html`).

Méthode :
- mesure automatique sur iPhone 13 des zones de toucher, des tailles de texte et des contrastes calculés de chaque élément ;
- lecture critique de la hiérarchie, des signes d'action et de la densité ;
- vérification des conventions iOS, pour une app web installée (PWA).

Les corrections notées « faites » sont déjà dans les maquettes ; les autres sont à traiter pendant l'implémentation.

## P1 · Avant l'implémentation

| # | Constat | Correction | État |
|---|---|---|---|
| 1 | Rien n'indique que toucher la bouteille ouvre les photos : la fonction est invisible depuis que la gestion du visuel a quitté la fiche | Pastille appareil photo sur la vignette, vrai bouton « Photos et aperçu de la bouteille » | Fait |
| 2 | Zones de toucher sous 44 px : pastille du Compte (36), recherche et boutons de filtre (40), « Sortir une bouteille » compact (36) | 44 px partout ; les petites pastilles (Sortir de la carte, photo) gardent leur taille visible et une zone de toucher étendue | Fait |
| 3 | Pas d'état « plus en cave » : le − descend à 0 et la fiche affiche « 0 en cave » avec Sortir actif | − désactivé à 0 ; à 0 bouteille : « Plus en cave », « Remettre 1 bouteille », « Ajouter aux envies » | Fait |
| 4 | Le − corrige le stock sans trace, sans retour possible ; idem après Sortir | Message de 5 s avec « Annuler » | Fait |
| 5 | Étoiles seules dans les dégustations : information portée par la couleur dorée (3,5:1) | Valeur écrite à côté (« 4/5 »), étoiles masquées aux lecteurs d'écran | Fait |
| 6 | En-tête sans le nouveau logo | Verre bordeaux devant « Vinicellar » | Fait |

## P2 · Pendant les lots

| # | Constat | Correction |
|---|---|---|
| 7 | La recherche placée au-dessus de la rangée prioritaire repoussait « À ouvrir en priorité » à mi-écran, alors qu'elle ne filtre que la grille | Recherche, filtres et bascule déplacés juste au-dessus de « Toute la cave » (fait dans la maquette) |
| 8 | Feuille Sortir : pas de glissement vers le bas pour fermer, ni de retour du focus | Glissement de plus de 90 px pour fermer, focus sur le premier choix à l'ouverture, retour au bouton d'origine (fait) ; à compléter par un piège à focus pendant l'implémentation |
| 9 | iOS n'applique pas la taille de texte choisie dans Réglages aux pages web en `rem` | Tester `html { font: -apple-system-body }` avec une base de 16 px. Vérifier que la fiche et la grille tiennent à la taille « grande » ; sinon, plafonner à 120 % |
| 10 | En app installée, pas de geste de retour depuis le bord gauche (iOS ne le fournit pas aux PWA) | Garder « ‹ Cave » en haut à gauche sur chaque écran secondaire ; ne jamais ouvrir une page sans bouton de retour |
| 11 | Barre d'état en mode installé : le contenu passe dessous si l'en-tête n'a pas de marge haute | Marge haute avec `env(safe-area-inset-top)` sur l'en-tête de l'app, à vérifier sur l'iPhone |
| 12 | Invités en lecture seule | Masquer Sortir, − / +, « Remettre » et la pastille photo ; garder la galerie en lecture |

## P3 · Finitions

| # | Constat | Correction |
|---|---|---|
| 13 | Cartes de hauteurs inégales quand un nom tient sur 1 ligne et son voisin sur 2 | Nom réservé sur 2 lignes (fait) |
| 14 | « bt. » à 11,7 px | 12 px (fait) |
| 15 | Libellés de la barre d'onglets à 11 px | Accepté : c'est la taille iOS standard |
| 16 | Contrôle segmenté à 40 px dans un cadre de 44 | Accepté : l'ensemble fait 44 px, comme le segmenté iOS |
| 17 | Bordeaux très présent dans la fiche (millésime, Sortir, apogée, frise) | À surveiller sur l'écran réel ; si c'est trop, le millésime passe en `--ink` |

## Conventions iOS · écarts voulus

- **Ajouter en pastille dans la barre d'onglets.** Apple préfère les actions hors de la barre ; on garde la pastille, car c'est l'action la plus fréquente après la consultation.
- **Feuille Sortir maison** plutôt qu'une feuille native, impossible en web. Elle reprend la poignée, le glissement vers le bas et le fond assombri.
- **Pas de mode sombre** : décision du cadrage.

## Résultat des mesures (iPhone 13)

- **Contrastes** : aucun texte sous 4,5:1, hors les étoiles décoratives.
- **Zones de toucher** : toutes à 44 px au moins, après correction.
- **Tailles de texte** : seuls les libellés de la barre d'onglets restent à 11 px, comme dans iOS.
- **Fiche** : bouteille, nom, millésime, note, stock, Sortir et les 6 lignes du tableau tiennent à l'écran avec 2 caves. La dernière ligne touche le bas de l'écran ; avec une seule cave, il reste 56 px.

## Suite : étape 8, implémentation par lots

Sur une branche dédiée, un lot à la fois, chacun testé sur iPhone avant le suivant :

1. **Fondations** :
   - jetons de l'étape 4 dans `app.css` et nettoyage des 63 sélecteurs redéfinis ;
   - retrait du mode sombre ;
   - composants partagés : vignette, statut de garde, feuille.
2. **Fiche** : F1 compactée, feuille Sortir, état « plus en cave ». Avec cette SQL à lancer par toi : provenance, préférences du tableau.
3. **Cave** : C1, cave comme accueil, sélecteur de cave, redirections des anciennes adresses.
4. **Navigation** : 4 onglets, Carnet regroupé, Compte, retrait de Studio.
