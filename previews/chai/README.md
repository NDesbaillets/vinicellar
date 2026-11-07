# Aperçu « Galerie du chai »

Prototype statique et isolé du frontend. Les chiffres, les noms des vins et les bouteilles CSS sont illustratifs. Aucun accès à Supabase, aucune modification de l'application ou de la production.

Pour afficher le prototype avec le serveur de revue local :

```sh
python3 scripts/preview-ui.py
cp previews/chai/index.html dist/review/chai.html
cp previews/chai/mobile.html dist/review/chai-mobile.html
cp previews/chai/*.jpg dist/review/
python3 -m http.server 8000 --directory dist
```

Ouvrir `/review/chai.html` ou `/review/chai-mobile.html`. Le panorama de Lavaux est déjà crédité dans `assets/img/lavaux/CREDITS.md` et `credits.html`.

Photographies complémentaires utilisées uniquement dans ce prototype :

| Fichier | Auteur et source | Licence |
| --- | --- | --- |
| `grapes.jpg` | LauraB26, [Grapes in Sun](https://commons.wikimedia.org/wiki/File:Grapes_in_Sun.jpg) | CC BY 4.0 |
| `bottles.jpg` | Jon Sullivan, [Wine bottles in a rack](https://commons.wikimedia.org/wiki/File:Wine_bottles_in_a_rack.jpg) | Domaine public selon la page Commons |
| `barrels.jpg` | Pradeep717, [Wine in oak barrels](https://commons.wikimedia.org/wiki/File:Wine_in_oak_barrels.jpg) | CC BY-SA 4.0 |
| `crate.jpg` | Dave Minogue, [Wooden wine storage box](https://commons.wikimedia.org/wiki/File:Wooden_wine_storage_box.jpg) | CC BY-SA 2.0 |

Les crédits figurent également dans le pied de page du prototype. Les photos définitives et leurs cadrages seront revus avant toute intégration à l'application.
