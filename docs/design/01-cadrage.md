# Refonte de l'interface · 1. Cadrage

Validé le 15.11.2026. Sert de référence aux étapes suivantes (benchmark, architecture, système visuel, maquettes, implémentation).

## Constat

- Usage réel (30 derniers jours) : 2 comptes, 44 vins, 58 bouteilles ; 46 analyses d'ajout, 4 conseils du Sommelier, 1 sortie par photo, 2 dégustations notées. L'app sert surtout à enregistrer ; choisir, sortir et noter sont peu utilisés.
- L'interface a connu trois directions successives (bordeaux d'origine, photos de Lavaux, « chai éditorial ») ; la feuille de style (835 lignes) accumule des corrections au cas par cas.
- La fiche vin est trop chargée : l'essentiel n'est pas lisible d'un coup d'œil.

## Énoncé du problème

Les amateurs qui gèrent ensemble leur cave (Nicolas et Viviane, la famille en lecture seule) doivent pouvoir voir l'essentiel d'un vin d'un coup d'œil, choisir quoi ouvrir et enregistrer une sortie en quelques gestes, sur iPhone, dans une interface cohérente qui garde l'identité de Vinicellar.

## Utilisateurs

Deux gestionnaires à égalité (dont une personne moins technophile), plus des invités en lecture seule. iPhone (app installée) d'abord, ordinateur en complément.

## Priorités (dans l'ordre)

1. Parcourir la cave et choisir quoi ouvrir
2. Ajouter une bouteille (parcours actuel conservé, habillé)
3. Sortir une bouteille et la noter
4. Sommelier

## Périmètre

Refonte visuelle et revue de la navigation, sans changer les fonctions. Livrée par lots, chacun validé sur une branche :

1. Fondations : couleurs, typographie, composants ; suppression du mode sombre
2. Fiche vin
3. Cave : grille, rangée « À ouvrir en priorité », sortie rapide
4. Navigation et autres écrans

## Identité

- Garder : palette actuelle (bordeaux, or), mot « Vinicellar » manuscrit (inchangé), grandes photos de Lavaux, direction « chai éditorial » (bois, caisses, fûts).
- Peut changer : la typographie des titres (Fraunces) ; propositions à l'étape 4.
- À venir : nouveau logo fourni par Nicolas, à animer dans un second temps.
- Supprimé : mode sombre (app toujours en clair, bouton retiré).

## Spécification de la fiche vin

**En-tête façon Vivino** : bouteille (aperçu détouré) mise en évidence ; drapeau du pays (emoji) dans le coin supérieur de la vignette ; nom, millésime, ma note.

**Visuel** : toucher la bouteille ouvre la galerie et la gestion des photos (vignette, ajout, aperçu, suppression). Plus de galerie ni d'outils photo affichés sur la fiche.

**En cave** : total en tête (« 3 bouteilles ») ; une ligne par cave avec + et − seulement si le vin est dans plusieurs caves, sinon + et − sur le total. « − » corrige le stock sans trace ; bouton principal « Sortir une bouteille » : bue ou offerte, avec note et date.

**Informations essentielles** (tableau), par défaut et dans cet ordre :
1. Région · appellation
2. Cépages
3. Garde : statut et fenêtre (« À l'apogée · 2026–2032 »)
4. Service : température, carafage si conseillé
5. Contenance
6. Provenance : lieu, prix, date, ou « reçu de »

Chaque utilisateur choisit ses lignes dans les préférences du compte, parmi : pays, région, appellation, producteur, cépages, millésime, degré, contenance, température, carafage, accords, statut de garde, fenêtre, apogée, note moyenne, ma note, prix d'achat, valeur actuelle, lieu d'achat, date d'achat, reçu de, emplacement. Préférences enregistrées par personne, suivies sur tous ses appareils.

**Provenance** : choix « Acheté / Reçu en cadeau / Autre ». Acheté → lieu, prix, date. Cadeau → de qui, occasion (pas de prix). Nouveau champ en base.

**Notes** : l'en-tête montre ma note seule ; la note moyenne trouvée en ligne figure dans la description du vin, à côté de la mienne.

**Toujours visibles** sous le tableau : la frise de garde et mes notes de dégustation (s'il y en a).

**Fiche complète** : un bouton « Voir la fiche complète » déplie le reste (description, vinification, terroir, millésime, accords, sources).

**Invités en lecture seule** : voient tout, sans les boutons de gestion.

## Autres écrans

- Cave : grille de bouteilles (2 colonnes sur iPhone) par défaut, bascule vers une liste ; rangée « À ouvrir en priorité » (apogée, à boire vite) en tête, défilant horizontalement.
- Ajouter : parcours inchangé, seulement habillé.
- Sortir : accessible en un geste depuis la grille et la fiche ; feuille courte (Bue / Offerte, étoiles et note sur le même écran).

## Critères de réussite (vérifiés sur iPhone)

1. Une fiche montre l'essentiel (bouteille, nom, millésime, note, stock, tableau) sans défiler.
2. Trouver une bouteille à ouvrir : 3 gestes au plus depuis l'ouverture de l'app.
3. Sortir une bouteille et la noter : 2 gestes au plus.
4. Viviane ajoute et sort une bouteille sans aide (test sur les maquettes de l'étape 5).
5. Tous les écrans partagent les mêmes couleurs, typographies, espacements et composants, sans correction au cas par cas.
6. Contraste et zones de toucher aux normes (AA, 44 px).

## Principes de décision

1. **La bouteille d'abord** : l'aperçu est le héros de chaque écran où un vin apparaît.
2. **L'essentiel d'un coup d'œil, le détail sur demande.**
3. **Le chai donne l'ambiance, pas le bruit** : photos de Lavaux et bois habillent les en-têtes et l'accueil, jamais derrière une information à lire.
4. **Un geste, une action** : chaque tâche fréquente a son bouton direct.

## Hors périmètre (idées notées)

- Rappel de sortie (« Vous avez ouvert quelque chose ce week-end ? »), si l'oubli s'avère être le frein.
- Animation du nouveau logo.
