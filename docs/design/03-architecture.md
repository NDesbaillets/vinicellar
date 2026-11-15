# Refonte de l'interface · 3. Architecture et navigation

Validé le 15.11.2026. Suite de `01-cadrage.md` et `02-benchmark.md`.

## Constat (usage réel)

Chaque utilisateur a 3 caves. La liste d'envies compte 1 vin, l'historique 3 vins passés. Personne n'est encore invité en lecture seule. Sortie par photo : 1 fois en 30 jours ; Sommelier : 4 fois.

## Navigation globale

Barre du bas, 4 onglets, dans l'ordre des priorités :

| Onglet | Contenu | Remarque |
|---|---|---|
| **Cave** | Toutes les bouteilles, sélecteur de cave en haut | Accueil de l'app |
| **Sommelier** | « Qu'est-ce qu'on mange ? » → 3 à 4 vins par plat | Nom conservé |
| **Ajouter** | Parcours d'ajout actuel | Mis en valeur (pastille bordeaux), pas au centre |
| **Carnet** | Dégustations · Vins passés · Envies · Bilan | Sélecteur de section en haut |

En haut : le mot « Vinicellar » manuscrit (lien vers la Cave) et le Compte à droite. Le bouton de thème est supprimé avec le mode sombre.

## Arborescence

```
Cave (accueil)
├── sélecteur : Toutes · <cave 1> · <cave 2> · … (dernier choix mémorisé, « Toutes » par défaut)
├── « Sortir par photo » (bouteille en main)
├── rangée « À ouvrir en priorité » (apogée, à boire vite), défilement horizontal
├── recherche · filtres · bascule grille / liste (grille par défaut)
├── bouteilles → Sortir (un geste, depuis chaque bouteille)
└── Fiche vin
    ├── en-tête : bouteille, drapeau, nom, millésime, ma note
    │   └── toucher la bouteille → galerie et gestion des photos
    ├── En cave : total, lignes par cave si plusieurs, + / −, « Sortir une bouteille »
    ├── tableau des informations essentielles (choix dans le Compte)
    ├── frise de garde · mes dégustations (toujours visibles)
    └── « Voir la fiche complète » → description, notes (moyenne en ligne et la mienne),
        vinification, terroir, millésime, accords, sources
Sommelier
└── menu → 3 à 4 vins par plat, gammes de prix → Sortir · Voir la fiche
Ajouter
└── photos → analyse → vérification (aperçu prêt) → enregistrement
Carnet
├── Dégustations (ex-Journal)
├── Vins passés (ex-Historique) → Racheter → Envies
├── Envies
└── Bilan
Compte
├── profil
├── préférences : lignes du tableau de la fiche, fond des aperçus
├── caves et partage
├── import / export
└── administration (admin seulement)
```

## Pages et adresses

| Page actuelle | Devenir |
|---|---|
| `app/index.html` (« Quelle cave ? ») | Devient la Cave (contenu de `cave.html`) ; bannières d'invitation et d'analyses prêtes conservées en tête |
| `app/cave.html` | Redirige vers `app/` en gardant le paramètre de cave |
| `app/sortir.html` | N'est plus un onglet ; reste la page « Sortir par photo » ouverte depuis la Cave |
| `app/journal.html` | Carnet › Dégustations |
| `app/historique.html` | Carnet › Vins passés |
| `app/envies.html` | Carnet › Envies |
| `app/bilan.html` | Carnet › Bilan |
| `app/caves.html` | Compte › Caves et partage (page conservée, accès depuis le Compte uniquement) |
| `app/importer.html`, `app/admin.html` | Accès depuis le Compte |
| `app/studio.html`, `assets/js/studio.js`, `studio-page.js` | Supprimés |

Les anciennes adresses restent valides (redirections), pour les favoris et l'app installée.

## Libellés

Cave · Sommelier · Ajouter · Carnet · Dégustations · Vins passés · Envies · Bilan · Compte · « À ouvrir en priorité » · « Sortir une bouteille » · « Sortir par photo » · « Voir la fiche complète ».

## Modèle de données à ajouter (implémentation des lots 2 et 3)

- **Provenance** : type (acheté, cadeau, autre) ; pour un cadeau, « reçu de » et occasion. Les champs d'achat existants (lieu, prix, année) restent.
- **Préférences par utilisateur** : liste ordonnée des lignes du tableau de la fiche ; fond des aperçus (aujourd'hui enregistré sur l'appareil, à déplacer dans le profil).

## Critères à vérifier sur cette architecture

- Trouver une bouteille à ouvrir : ouvrir l'app (Cave) → rangée « À ouvrir en priorité » → bouteille : 2 gestes.
- Sortir et noter : bouton Sortir sur la bouteille → Bue ou Offerte avec les étoiles sur le même écran : 2 gestes.
- Tout réglage se trouve dans le Compte.
