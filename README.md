# vinicellar.ch

Web-app de gestion de cave (vins, whiskies, sakés, rhums, cognacs, gins, liqueurs). HTML, CSS et JavaScript sans build, hébergés sur GitHub Pages ; comptes, données et photos dans Supabase (Zurich) ; identification des étiquettes par une Edge Function qui appelle l'API Claude avec recherche web.

## Architecture

| Couche | Outil | Coût |
| --- | --- | --- |
| Pages | GitHub Pages (dépôt `NDesbaillets/vinicellar`, branche `main`) | gratuit |
| Comptes, base, photos | Supabase, projet `vinicellar` (`ysdkbkujgbkrpjishttp`, eu-central-2 Zurich) | gratuit jusqu'à 500 Mo de base / 1 Go de fichiers |
| Lecture d'étiquette + fiche | Edge Function `identify` → API Anthropic (Claude Sonnet 5.5 + web search/fetch) | env. 0,05–0,15 $ par analyse |
| Domaine | Infomaniak (`vinicellar.ch`) | déjà payé |

Le dépôt est public : rien de secret n'y va. La clé `publishable` de `assets/js/config.js` est publique par conception, la sécurité repose sur les règles RLS de `supabase/schema.sql` (chaque utilisateur ne voit que ses lignes et son dossier de photos).

## Arborescence

```
index.html                  accueil + connexion + création de compte
bienvenue.html              première connexion : mot de passe, nom, caves
nouveau-mot-de-passe.html   lien « mot de passe oublié »
app/index.html              choix de la cave (et invitations de partage en attente)
app/cave.html?loc=…         tableau de bord d'une cave (rouges, blancs, cépages…), filtres, liste, sortie en un geste
app/sortir.html             sortir une bouteille : photo reconnue parmi le stock, ou liste ; bue / offerte / autre
app/fiche.html?id=…         fiche bouteille, stock par lieu, « J'ouvre une bouteille », garde, accords, dégustations
app/ajouter.html            photo (appareil ou album) ou nom → analyse → fiche à vérifier → stock
app/journal.html            carnet de dégustation
app/importer.html           import d'un tableau Excel/CSV (modèle, consigne pour Claude, aperçu, création des fiches)
app/caves.html              caves et partage (inviter conjoint ou famille par e-mail)
app/compte.html             profil, mot de passe, export CSV, déconnexion
assets/js/core.js           client Supabase, session, navigation, formulaire de fiche, étoiles
supabase/schema.sql         tables, RLS, fonctions (drink_bottle, adjust_stock, move_stock, undo_tasting), bucket `labels`
supabase/sharing.sql        partage (collections, membres, invitations) et sorties (bue, offerte, autre)
supabase/functions/identify Edge Function d'identification (photo → fiche complète, recherche web)
supabase/functions/match    Edge Function de reconnaissance d'une bouteille du stock (photo → sortie)
supabase/templates/         e-mails (invitation, lien de connexion, mot de passe)
```

## Ce qui est déjà fait

- Projet Supabase `vinicellar` créé, schéma appliqué, aucune alerte de sécurité.
- Edge Function `identify` déployée (JWT obligatoire, quota 30 analyses / 24 h / utilisateur).

## À faire (une fois)

1. **Clé Anthropic** : console.anthropic.com > API Keys > créer une clé, puis Supabase > *Edge Functions* > *Secrets* > `ANTHROPIC_API_KEY`. Fixer une limite de dépense mensuelle dans la console Anthropic. Optionnel : `AI_DAILY_LIMIT`.
2. **Supabase > Authentication > URL Configuration** : Site URL `https://vinicellar.ch` ; Redirect URLs `https://vinicellar.ch/**`.
3. **Inscriptions** : *Sign In / Providers* > Email. Laisser *Allow new users to sign up* activé pour l'onglet « Créer un compte » ; le désactiver pour un accès sur invitation (et mettre `openSignup: false` dans `config.js`). Minimum de mot de passe : 10.
4. **E-mails** : *Authentication* > *Emails* > *SMTP Settings* : brancher une adresse Infomaniak (ex. `noreply@vinicellar.ch`, serveur `mail.infomaniak.com`, port 465). Sans SMTP propre, Supabase limite l'envoi à quelques e-mails par heure. Coller ensuite les modèles de `supabase/templates/` (Invite user, Magic Link, Confirm signup, Reset password).
5. **DNS chez Infomaniak** (zone DNS de vinicellar.ch) :
   - 4 enregistrements `A` sur `@` : `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - (optionnel) 4 `AAAA` : `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - 1 `CNAME` `www` → `ndesbaillets.github.io.`
   - supprimer les enregistrements A/AAAA par défaut d'Infomaniak sur `@` et `www`.
6. **GitHub** : *Settings* > *Pages* : source `main` / root, domaine `vinicellar.ch`, cocher *Enforce HTTPS* (certificat en quelques minutes à 24 h). Recommandé : vérifier le domaine dans *Settings (profil)* > *Pages* (enregistrement TXT) pour empêcher sa reprise par un tiers.

## Bases de données pour l'identification

Aucune base ouverte ne couvre à la fois identification, garde, notes et prix. Choix retenu : lecture de l'étiquette par Claude (vision), puis recherche web ciblée (site du producteur d'abord, cavistes suisses pour le prix, Vivino/CellarTracker/Whiskybase/Sakenowa pour notes et garde). Chaque fiche garde ses sources et reste modifiable.

Compléments possibles, par ordre d'intérêt :

| Source | Apport | Accès |
| --- | --- | --- |
| Wine-Searcher API | prix moyen du marché, score critique agrégé, ~ toutes cuvées | payant (contrat commercial) |
| LWIN (Liv-ex) | identifiant unique du vin (dédoublonnage, liens entre bases) | téléchargement gratuit |
| CellarTracker | fenêtres de garde et notes communautaires (millions de notes) | pas d'API publique, export perso uniquement |
| Vivino | note /5 grand public, reconnaissance d'étiquette | pas d'API publique (CGU interdisent le scraping) |
| Whiskybase | référence whisky (embouteillages, notes) | pas d'API publique |
| Sakenowa Data Project | sakés : profils aromatiques, classements | API gratuite (japonais) |
| Open Food Facts | code-barres EAN → produit | gratuit, couverture vin faible |

## Cache des navigateurs

Les pages chargent CSS et JS avec `?v=20261105-ui2`. Après modification, changer ce suffixe partout et versionner le cache de `sw.js` si nécessaire.

## Vinicellar 2 · Phase A (branche de revue)

La modernisation conserve HTML/CSS/JavaScript natifs, les tables existantes et les permissions par collection. Aucune migration ou modification de fonction Supabase n'est incluse.

- Palette Terroir contemporain ; Fraunces et Inter conservées. Thème système/clair/sombre mémorisé sur l'appareil.
- Catalogue photographique : deux colonnes sur mobile, trois à cinq sur écran large ; vue liste compacte mémorisée. Les filtres, tris, liens de fiche et sorties rapides restent disponibles.
- Les étiquettes et photos restent identifiées comme telles. Le CSS ne transforme pas un fond opaque en transparence et ne crée aucune bouteille Studio.
- Photographie authentique du Lavaux : attribution visible et détails dans [credits.html](credits.html) et [CREDITS.md](assets/img/lavaux/CREDITS.md).
- Les anciennes photos remplacées sont conservées dans `photo_paths`. Retirer une photo de la galerie, supprimer une fiche ou supprimer un brouillon ne supprime plus les fichiers sources du stockage privé. Les fichiers détachés n'ont pas encore d'interface de restauration ; ne pas mettre en place de purge automatique.
- Le cache des URL signées suit leur expiration et distingue les buckets.

Validation locale, sans dépendance à installer :

```sh
node --test tests/core.test.cjs
python3 scripts/preview-ui.py
python3 -m http.server 8000 --directory dist
```

Ouvrir `/review/compare.html` ou `/review/mobile.html` sur ce serveur. Les sources avant/après sont exécutées avec les mêmes données fictives et des bouteilles illustratives. Le client est simulé et la CSP bloque les connexions réseau aux données (`connect-src 'none'`). `dist/` est un aperçu local ignoré par Git, pas un nouveau frontend de production.

Résultats, limites de vérification et captures : [docs/phase-a-review.md](docs/phase-a-review.md).

La phase B (Studio), les migrations, les fournisseurs d'image et toute mise en production requièrent une validation distincte. Ne pas fusionner la branche de revue avant cette décision.
