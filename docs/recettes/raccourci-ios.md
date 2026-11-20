# Raccourci iOS « Envoyer à ARÔMES »

Ce raccourci ajoute « Envoyer à ARÔMES » à la feuille de partage de Notes (et de toute app qui partage du texte). Il ouvre l'onglet **Note** de ARÔMES V&N avec le texte de la note déjà collé ; il ne reste qu'à ajouter les photos et à toucher « Créer la fiche ».

## Créer le raccourci

1. Ouvrir l'app **Raccourcis**, onglet **Raccourcis**, toucher **+** (en haut à droite).
2. Toucher le nom en haut, choisir **Renommer** et saisir `Envoyer à ARÔMES`.
3. Toucher l'icône d'information (i) en bas, activer **Afficher dans la feuille de partage**. Dans « Types acceptés », ne laisser cochés que **Texte** (et **Notes** si proposé) : décocher le reste.
4. Revenir à l'éditeur et ajouter les actions, dans cet ordre (champ de recherche en bas, « Ajouter une action ») :
   1. **Recevoir** « Texte » depuis la feuille de partage. Cette première action est déjà là quand l'étape 3 est faite ; laisser « Si aucune entrée » sur **Continuer**.
   2. **Encoder l'URL** (ou « Encoder/Décoder l'URL ») : choisir **Encoder** et, comme texte, la variable **Entrée de la feuille de partage**.
   3. **Texte** : saisir exactement
      `https://vinicellar.ch/recettes/ajouter.html?onglet=note&text=`
      puis, juste après le `=`, insérer la variable **Texte encodé** (touche de la variable, résultat de l'action précédente).
   4. **Ouvrir les URL** : choisir la variable **Texte** de l'étape précédente. Le raccourci s'ouvre dans **Safari**.
5. Toucher **OK**.

Les intitulés exacts varient légèrement selon la version d'iOS ; le principe reste : recevoir le texte, l'encoder, le glisser derrière `text=`, ouvrir l'adresse.

## Utiliser le raccourci

1. Dans **Notes**, ouvrir la note, toucher **Partager** (carré avec flèche) puis **Envoyer à ARÔMES** (le faire défiler dans la liste d'actions, ou **Modifier les actions** pour l'épingler).
2. Safari ouvre ARÔMES V&N, onglet **Note**, texte prérempli. Se connecter si demandé.
3. Choisir le carnet, ajouter les photos (voir plus bas), relire le texte, toucher **Créer la fiche**.

L'option `?onglet=note` force l'onglet Note même si la note contient une adresse web (une note de recette cite souvent sa source). Sans elle, un texte contenant une adresse http(s) ouvrirait l'onglet **Lien**.

## Les photos de la note

Les images d'une note Apple ne passent pas par le partage de texte. Pour chaque photo :

1. Dans la note, **appui long sur la photo, puis Copier**.
2. Dans ARÔMES, onglet **Note**, toucher la zone **Coller une photo**, puis **Coller** dans la bulle qui apparaît (ou toucher **Coller depuis le presse-papiers**, puis autoriser l'accès si iOS le demande).
3. Répéter pour chaque photo (6 au plus). La première est la couverture ; les flèches changent l'ordre, la croix retire une photo.

On peut aussi choisir des photos de la photothèque avec « Choose Files » / « Choisir des fichiers » : enregistrer d'abord l'image dans Photos (appui long sur l'image, **Enregistrer dans Photos**).

## Limites

- **Longueur d'adresse** : le texte voyage dans l'adresse. Au-delà d'environ 8 000 caractères une fois encodé (les accents et sauts de ligne comptent triple), iOS ou Safari peut tronquer ou refuser l'ouverture. Pour une très longue note : ouvrir ARÔMES, onglet **Note**, et coller le texte à la main (copier la note entière, puis coller dans la zone de texte).
- Le texte est limité à 20 000 caractères ; le compteur sous la zone de texte l'indique.
- L'écriture manuscrite ou les tableaux de Notes ne sont pas repris : seul le texte l'est.
- Sur Android, le partage vers l'app installée (menu Partager, ARÔMES V&N) donne le même résultat sans raccourci.
