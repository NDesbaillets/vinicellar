# Eurêka, Vivcolas ! Cadrage fonctionnel et technique

État au 24.11.2026. Ce document fait foi. Toute décision qui s'en écarte se pose au propriétaire du projet (Nicolas Desbaillets). Interface en français, dates JJ.MM.AAAA, unités métriques, devise CHF.

## 1. Objectif

Un recueil d'idées de sorties pour un couple (week-ends, escapades, restaurants, culture, initiations, sport et neige, dégustations, bien-être, événements datés, sorties entre amis), avec :
- ajout en un geste (texte, lien, reel Instagram, photo d'affiche ou de journal),
- fiches qui donnent envie (photo, accroche, carte, infos pour réserver),
- rappels qui poussent à agir au bon moment, avec insistance (le propriétaire procrastine),
- planification croisée avec les agendas iCloud et Gmail.

Hébergement : `vinicellar.ch/eureka/`, même domaine, même projet Supabase (« vinicellar », Zurich), même session d'auth que Vinicellar et ARÔMES V&N. Identité visuelle propre (section 10). Modèle à suivre : `/recettes/` (manifeste, service worker à portée propre, CSS propre).

## 2. Espaces et utilisateurs

- Tout est rattaché à un **espace**. L'espace de Nicolas et Viviane est unique et partagé. D'autres personnes pourront créer leur espace, strictement isolé (parcours d'inscription hors v1, mais modèle prêt dès le départ).
- Comptes : ceux de Vinicellar (Supabase Auth). L'accès à Eurêka dépend de l'appartenance à un espace, jamais du simple statut « connecté » (les amis de Vinicellar ont des comptes).
- Chaque membre a ses propres scores d'envie. Score couple = moyenne des envies, ou valeur saisie à la main qui la remplace.
- **Viviane n'est jamais prévenue de l'insistance qui concerne Nicolas.** Elle peut demander à suivre une idée précise ; Nicolas accepte ou refuse chaque demande, idée par idée. Seules les idées acceptées déclenchent un message vers elle (jour 7 de l'échelle).

## 3. Décisions arrêtées

- Interface : app séparée sous `/eureka/`, design Atelier (maquettes dans `docs/eureka/maquettes/`).
- Échelle des envies : 0 à 10. Urgence : 1 à 5.
- Format indépendant de la distance : demi-journée, journée, week-end, séjour. Distance depuis Nyon en filtre à part.
- Idées génériques sans lieu (« journée de ski ») avec liste d'options facultative.
- Idées récurrentes (rythme en mois). À la fin d'une activité : bouton « À reprévoir ? » crée l'occurrence suivante.
- Sorties sociales : liste de personnes avec rythme souhaité (« ça fait 4 mois que... »). Hors v1.
- Doublons : détection par similarité (pg_trgm, déjà actif). Fusion proposée ; une idée ajoutée plusieurs fois (par l'un ou l'autre) gagne en priorité.
- Événements datés expirés : planifiés, ils passent en « faite » avec demande de note en une ligne ; sinon archivés automatiquement, retrouvables.
- Plafond de dépense IA : 10 CHF par mois et par espace, réglable, alerte à 70 %, pause de l'enrichissement au plafond.

## 4. Modèle de données (tables `public.sorties_*`, RLS dès la création)

- `sorties_espaces` (id, nom, plafond_ia_mensuel_chf, cree_le)
- `sorties_espace_membres` (espace_id, user_id, role owner|membre|lecteur, prenom_affiche)
- `sorties_idees` : espace_id, titre, accroche, description, categorie, format (demi_journee|journee|week_end|sejour), type_lieu (lieu|generique), adresse, ville, lat, lng, site_reservation, telephone, budget_min, budget_max, meilleure_periode (mois[]), preavis_semaines, date_debut, date_fin, date_limite_reservation, urgence, statut (envie|preselection|planifiee|faite|archivee|manquee), score_couple_manuel (null = moyenne), recurrence_mois (null), image_path, source_url, source_type (texte|lien|reel|photo|web), notes, ajoutee_par, nb_ajouts, fusionnee_dans, a_verifier (jsonb : champs douteux), tsv (recherche plein texte français, unaccent), cree_le, maj_le
- `sorties_envies` (idee_id, user_id, score 0..10, maj_le)
- `sorties_options` (idee_id, nom, lieu, lat, lng, lien, note)
- `sorties_occurrences` (idee_id, date_cible, date_realisee, statut prevue|faite|annulee, evenement_ref) et `sorties_notes_occurrence` (occurrence_id, user_id, note, commentaire)
- `sorties_personnes` et `sorties_idees_personnes` (hors v1, schéma prévu)
- `sorties_inbox` (espace_id, user_id, type lien|texte|photo, contenu, image_path, statut nouveau|en_cours|traite|echec, idee_id, erreur)
- `sorties_rappels` (idee_id, user_id, type echeance|suggestion, etape 0|3|7|10, prevu_le, envoye_le, canal, reponse reserve|reporte|archive|null, reporte_jusqua)
- `sorties_suivis` (idee_id, demandeuse, statut en_attente|accepte|refuse, cree_le, decide_le)
- `sorties_reglages` (user_id, espace_id, max_notifs_par_jour=2, heure_semaine=18:30, heure_weekend=10:00, ton direct_humour|neutre, poids_classement jsonb, calendrier_ecriture_id)
- `sorties_push_subscriptions` et `sorties_notifications_outbox` (même modèle que `recipe_push_subscriptions` et `recipe_notifications_outbox`)
- `sorties_calendriers` (user_id, nom, href CalDAV, actif=false, mode occupe|titres = occupe, ecriture=false)
- `sorties_occupation` (calendrier_id, debut, fin, titre nullable, uid_externe, maj_le)
- Journal IA : réutiliser `public.ai_calls` avec kind `sorties-*`.

Fonctions d'accès sur le modèle de `supabase/sharing.sql` : `sorties_is_member(espace)`, `sorties_is_editor(espace)`, `sorties_is_owner(espace)`. Ne jamais modifier les tables ou fonctions existantes de Vinicellar ou ARÔMES.

## 5. Ajout d'une idée

Entrées : (a) texte libre, (b) lien web, (c) lien de reel Instagram, (d) **photo** (affiche, annonce de journal).
- Webapp : champ « Ajouter » (texte ou lien) et bouton « Photo » qui ouvre l'appareil photo ou la galerie. Écrit dans `sorties_inbox`.
- Raccourci iPhone (feuille de partage, lien ou photo) vers l'inbox, sur le modèle de `docs/recettes/raccourci-ios.md`.
- Fonction `sorties-enrich` (modèle : `recipe-import`, qui gère déjà Apify pour les reels, la lecture de photos de pages et le triage Claude) : extrait titre, dates, lieu, prix, téléphone, site, **QR code**, puis cherche le site officiel pour compléter (billetterie, horaires, adresse exacte), génère l'accroche d'une ligne et propose catégorie, format et préavis.
- Photo d'affiche : les dates extraites remplissent date_debut, date_fin, date_limite_reservation et l'urgence. Année absente : prochaine occurrence, marquée à vérifier. Tout champ incertain va dans `a_verifier`, jamais de valeur inventée. La photo d'origine est conservée dans un bucket privé ; pour un événement, elle sert de visuel de carte. Plusieurs photos par idée possibles.
- La fiche est enregistrée tout de suite, sans écran de validation. Si la lecture échoue, l'idée est créée quand même avec la photo et un message « à compléter ».
- Images : vignette du reel, sinon image du site officiel, sinon recherche d'images (autorisée : usage privé, site protégé par mot de passe), sinon visuel de remplacement.
- Chaque appel est journalisé dans `ai_calls` et soumis au plafond de l'espace.

## 6. Rappels

Deux types, tous deux envoyés en web push (modèle `recipe-notify`, secrets VAPID existants), e-mail en secours pour les enjeux forts.
- **À échéance** (réserver avant une date) : date de rappel = date cible moins préavis. Échelle : jour 0 doux avec un seul bouton « Réserver » ; jour 3 plus ferme, compte à rebours, créneau provisoire dans l'agenda (une fois le miroir iCloud en place) ; jour 7 e-mail, et message à Viviane seulement si suivi accepté ; jour 10 « réserver ou abandonner », sans réponse l'idée passe en `manquee`. L'échelle s'arrête dès que Nicolas agit.
- **Sans échéance** (suggestions) : douces, sans escalade, avec boutons « Libre ce week-end ? Oui / Non » (Non reporte de quelques jours). Classement : envie couple × urgence × adéquation saison, plus bonus par ajout répété, moins malus si suggérée récemment ; chaque suggestion affiche « pourquoi celle-ci ». Poids réglables.
- Report : 3 jours, 1 semaine, 2 semaines. Après deux reports : « Toujours d'actualité ? » (Oui, Archiver, Baisser la priorité).
- Plafond : 2 notifications par jour au total. Heures par défaut paramétrables (semaine 18:30, week-end 10:00).
- Ton par défaut : direct, complice, une pointe d'humour. Ni culpabilisant, ni infantilisant.
- Planification : `pg_cron` et `pg_net` (déjà actifs) déclenchent une fonction qui remplit l'outbox.

## 7. Agendas

- Miroir iCloud par CalDAV (fonction Supabase, mot de passe d'application Apple en secret Supabase, saisi par le propriétaire lui-même). Calendriers découverts : non synchronisés tant que non activés ; une fois activés, « occupé seulement » par défaut jusqu'à autorisation des titres. Calendriers liés au travail : plages seules.
- Écriture uniquement dans un calendrier dédié « Eurêka », créé et partagé avec Viviane à la main dans iCloud ; le calendrier de destination reste modifiable dans les réglages.
- Étape 4 de la construction : la v1 est utilisable avant. D'ici là, la planification se fait par Claude depuis l'app mobile.

## 8. Rôle de Claude

Projet Claude « Sorties » (planification conversationnelle, lecture des agendas, création d'événements), opérations en lot (vérifier prix et fermetures, dédoublonner, relancer l'enrichissement, importer le backlog), résumé hebdomadaire. Hors de l'app et du code ci-dessous.

## 9. Recherche et interface

Recherche plein texte française (titre, accroche, description, lieu, tags, notes) + filtres cumulables : catégorie, format, saison, statut, couple ou seul, distance depuis Nyon. Tri par priorité. Bouton « Surprends-moi ».

## 10. Design Atelier

Référence : `docs/eureka/maquettes/` (Accueil, Fiche, Style = planche de style). Les fichiers `.dc.html` sont du balisage de référence : ignorer le wrapper `x-dc`, `support.js` et le script, reprendre le HTML, les styles en ligne et les valeurs.
- Couleurs : ivoire #F3ECE6, papier #FBF8F5, terracotta #9A4A2B (actions, accents), rose poudré #D9B7A8 (aplats décalés derrière les photos), sauge #7E8A6E (décor), gris chaud #C9C2BC, filets #D8CFC7, encre #211C19, encre douce #6B5F57.
- Typographie : Cormorant Garamond (titres, italiques pour les accroches), Jost (labels en capitales espacées 10 px, texte 13 à 15 px).
- Un seul bouton terracotta par écran, accroche d'une ligne, badge d'urgence quand la fenêtre se ferme, filets fins, beaucoup d'air. Cibles tactiles d'au moins 44 px. Contraste de texte d'au moins 4,5:1.
- Ne jamais importer `assets/css/app.css`, `core.js` ni les feuilles de `/recettes/`. Les photos des maquettes sont des illustrations de remplacement.
- Nom de l'app : Eurêka, Vivcolas ! Monogramme V&N.

## 11. Ordre de construction

1. Base et accès par espace (`supabase/eureka.sql`, relu par le propriétaire avant toute application), webapp en lecture et édition, recherche et filtres, scores, récurrence simple.
2. Ajout rapide (texte, lien, reel, photo) et enrichissement automatique, raccourci iPhone.
3. Rappels web push avec insistance, suggestions, suivis de Viviane.
4. Miroir iCloud, créneaux provisoires automatiques.
5. Projet Claude « Sorties » et tâches planifiées.
6. Ensuite : personnes et sorties sociales, souvenirs détaillés, inscription d'autres utilisateurs.

## 12. Contraintes et faits vérifiés

- Site statique GitHub Pages, HTML et JS vanilla, aucun build, `main` publié en production à chaque push : travailler sur la branche `eureka`.
- Aucune clé secrète côté client. Appels IA, Apify et CalDAV par fonctions Supabase, avec secrets (ANTHROPIC_API_KEY, GEMINI_API_KEY, APIFY_TOKEN, VAPID_*) et journalisation dans `ai_calls`.
- Extensions déjà actives : pg_cron, pg_net, pg_trgm, unaccent, vault, pgcrypto. Aucune table `sorties_*` n'existe encore. Des avertissements de sécurité préexistants sur des fonctions de Vinicellar ne concernent pas ce chantier.
- Les migrations ne sont jamais appliquées à la base de production par l'agent de code : produire le fichier SQL, le propriétaire relit.

## 13. À vérifier ou à faire par le propriétaire

- Le secret `APIFY_TOKEN` existe-t-il dans Supabase (sinon le créer dans le tableau de bord, jamais dans un prompt) ?
- Mot de passe d'application Apple à générer et à saisir en secret Supabase (étape 4).
- Créer le calendrier « Eurêka » dans iCloud et le partager avec Viviane.
- Envoyer le backlog d'idées existant pour constituer une quinzaine de fiches de départ.
- Vérifier qu'une tâche planifiée Claude accède bien à Supabase et au web (sinon l'enrichissement et les rappels restent côté Supabase seul, ce qui est le cas nominal).
