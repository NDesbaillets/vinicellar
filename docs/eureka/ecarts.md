# Écarts de l’étape 1

- **Retour après connexion.** Eurêka redirige vers `/recettes/connexion.html` avec l’adresse demandée. Cette page accepte uniquement les destinations sous `/recettes/`. Après connexion, rouvrir `/eureka/` ou la fiche d’origine. La session est déjà partagée.
- **Trigrammes.** Le schéma possède un index sur le titre normalisé, mais ne publie aucune fonction de recherche par similarité. PostgREST expose la recherche plein texte et la normalisation via `sorties_unaccent`. Si la recherche plein texte ne donne aucun résultat dans les filtres actifs, le navigateur compare les trigrammes des titres de l’espace chargé.
- **Visuels.** Une URL HTTPS dans `image_path` est affichée directement. Le schéma Eurêka ne déclare ni bucket ni politiques de stockage pour les chemins privés. Un chemin de bucket ou une image inaccessible laisse la place au visuel Atelier. L’import de photos est prévu à l’étape 2.
- **Planification.** Le schéma permet d’insérer une occurrence et de modifier l’idée séparément. Si le créneau est créé mais que l’actualisation échoue, la fiche le signale et permet de réessayer. Les créneaux prévus déjà connus pour cette date sont réutilisés. Le schéma ne garantit pas l’unicité d’une date en cas de créations simultanées.

## Contrôle des politiques de lecture des étapes 3 et 4

| Politique | Verdict | Contrôle d’accès |
| --- | --- | --- |
| `sorties_occupation_perso` | Corrigée | La politique compare directement `c.user_id` à `auth.uid()` et exige toujours un calendrier actif et disponible. |
| `sorties_calendriers_perso` | Justifiée | La ligne doit appartenir à l’utilisateur connecté, et sa liaison d’agenda doit être active. |
| `sorties_creneaux_perso` | Justifiée | La sous-requête vérifie déjà que le calendrier appartient à l’utilisateur connecté. La liaison d’agenda de l’espace est également exigée. |
| `sorties_rappels_lecture` | Justifiée | La ligne doit appartenir à l’utilisateur connecté, qui doit aussi être membre de l’espace. |
| `sorties_reglages_lecture` | Justifiée | La ligne doit appartenir à l’utilisateur connecté, qui doit aussi être membre de l’espace. |
| `sorties_suivis_lecture` | Justifiée | La demande est lisible par son auteur ou par le destinataire principal désigné. Pour ce second cas, `sorties_gere_suivis` vérifie le droit d’édition et compare explicitement l’identifiant du destinataire à `auth.uid()`. |

Dans PostgreSQL en mémoire, un second membre du même espace obtient zéro calendrier et zéro plage de l’autre membre. En ajoutant temporairement une politique qui rend les calendriers lisibles par tous les comptes authentifiés, le second membre voit les calendriers mais toujours aucune plage ni aucun titre.

## Suppression définitive d’une fiche

- **Ordre du nettoyage.** La suppression de la fiche enregistre les chemins des photos rattachées dans une file au sein de la même transaction. Le navigateur efface ensuite les fichiers via l’API Storage. Un refus de suppression laisse la fiche et ses photos intactes. Toute photo qui reste à effacer pourra être reprise lors de la prochaine visite d’un éditeur de l’espace. La file est acquittée uniquement lorsque l’objet a disparu du bucket.
- **Dépendances.** Les scores, options, occurrences et leurs notes, liens vers les personnes, suivis, rappels et liens de photos sont supprimés en cascade. Lorsqu’elle est installée, l’étape 3 supprime aussi les notifications associées aux rappels. La migration de l’étape 5 supprime également l’entrée d’import liée. Une autre fiche qui pointait vers la fiche supprimée lors d’une fusion est conservée et son lien est vidé.
- **Créneau iCloud.** L’étape 4 garde temporairement la référence de retrait avec `rappel_id` à `NULL`. Le calendrier est nettoyé par le cron iCloud déjà prévu, sans appel supplémentaire depuis la page. Le retrait dépend du bon fonctionnement de la liaison. Un événement modifié dans iCloud ou devenu inaccessible est signalé comme conflit pour vérification manuelle.
- **Mise en service.** Claude doit appliquer uniquement [`supabase/eureka-etape-5.sql`](../../supabase/eureka-etape-5.sql), après `eureka.sql` et `eureka-etape-2.sql`, puis publier les pages. Les migrations et le cron des étapes 3 et 4 restent les prérequis du retrait iCloud. Aucune Edge Function à redéployer pour ce correctif.

## Photos d’une fiche existante

L’illustration ajoutée par un éditeur devient la couverture. Les autres illustrations restent dans la fiche. Les photos souvenirs sont rattachées à la même fiche dans une galerie distincte et ne changent pas la couverture. Tous les fichiers restent dans le bucket privé. Les photos importées avant cette mise à jour sont classées comme illustrations.

Le formulaire accepte les JPEG, PNG et WebP de 5 Mo maximum, comme l’ajout rapide. Pour activer les formulaires et le nettoyage des nouveaux chemins de photos, appliquer ou rejouer [`supabase/eureka-etape-5.sql`](../../supabase/eureka-etape-5.sql) avant la publication du site. Cette fonctionnalité photo ne demande aucun redéploiement de fonction. Le redéploiement de `sorties-enrich` reste nécessaire pour le correctif des reels.

## Activités à prévoir chaque année

Dans la fiche à modifier, choisir **Récurrence → Chaque année**, puis les premier et dernier mois de la saison. Une saison peut traverser le Nouvel An. Deux mois identiques correspondent à un seul mois. Les récurrences exprimées en nombre de mois restent disponibles.

L’accueil liste les saisons à planifier. Une occurrence prévue dans la période, ou une occurrence réalisée pendant celle-ci, satisfait la tâche annuelle. Les occurrences annulées restent dans l’historique et ne satisfont pas la tâche. L’année suivante, la fiche retrouve une nouvelle période à planifier. Cet affichage fonctionne dans l’application et n’ajoute aucun envoi de notification.

Pour mettre en service, appliquer [`supabase/eureka-etape-6.sql`](../../supabase/eureka-etape-6.sql) avant la publication du site. La migration ajoute deux mois à la fiche et laisse les politiques RLS en place. Aucun redéploiement de fonction n’est nécessaire pour la récurrence annuelle.

## Créneaux de planification et météo

- Les fiches existantes et les brouillons d’import restent consultables. Il faut confirmer la durée d’activité, les deux durées de trajet depuis et vers Nyon, l’heure de début et les jours possibles avant de programmer une nouvelle occurrence. Pour un week-end, le samedi sert de date de référence, avec départ le vendredi soir facultatif et retour possible jusqu’au vendredi suivant.
- Le créneau couvre toute l’absence. Les anciennes occurrences prévues sans horaires bloquent leur journée entière. L’agenda vérifie aussi les plages iCloud que le compte connecté a choisi de rendre disponibles. Les créneaux de rappel automatiques ne changent pas.
- La météo utilise les coordonnées de la fiche. En Suisse, les cinq premiers jours privilégient les modèles ICON-CH1 et ICON-CH2 de [MétéoSuisse Open Data](https://www.meteosuisse.admin.ch/services-et-publications/service/open-data.html), distribués par l’API [Open-Meteo](https://open-meteo.com/en/docs) avec le modèle `meteoswiss_icon_seamless`. L’API générale d’Open-Meteo fournit les autres dates et lieux et sert de secours si les données suisses manquent. Chaque date indique sa source lorsque les deux sont utilisées. Au-delà de l’horizon de prévision, la date reste visible avec un état d’indisponibilité.
- Sélection du modèle par les coordonnées et une frontière indicative embarquée, extraite du jeu public [Natural Earth Admin 0 au 1:10 millions](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/) via [Geo Countries, révision ca3b715](https://github.com/datasets/geo-countries/tree/ca3b7150caa5d3cc3fb108a87fc6e3d57bd97d99).
- Déploiement par le propriétaire. Appliquer `supabase/eureka-etape-7.sql`, redéployer l’Edge Function `sorties-enrich`, puis publier la branche. Les règles RLS existantes sont conservées.

La demi-journée flexible occupe quatre heures d’activité. Le calendrier cherche un début par pas de 30 minutes, entre 8 h et 16 h, en comptant les deux trajets dans la recherche de disponibilité. L’heure retenue est enregistrée sur l’occurrence. Appliquer `supabase/eureka-etape-8.sql` après l’étape 7 et avant la publication du site.

## Suggestions par période

La planification vérifie les créneaux, les trajets et les plages occupées synchronisées avant d’afficher ses suggestions. Pour une demi-journée, les suggestions se limitent à 60 minutes de trajet aller depuis Nyon. Le délai minimal pour réserver est distinct du préavis de rappel. Une fiche sans renseignement de réservation reste éligible avec la mention « Réservation non renseignée ». En dehors de la période synchronisée par iCloud, Eurêka indique que la disponibilité est inconnue.

Appliquer `supabase/eureka-etape-10.sql` avant de publier l’interface. Aucun changement des règles RLS ni redéploiement de fonction.

## Suggestions de Claude pour la saison et les conditions

La complétion d’une fiche existante peut proposer une saison, les mois propices, les jours d’ouverture, un délai de réservation, les trajets et des conditions comme l’enneigement. L’enregistrement valide les valeurs encore présentes dans le formulaire. Les mois propices influencent la planification. Les conditions restent visibles dans les suggestions, et la météo en direct est consultable dans le calendrier.

Appliquer `supabase/eureka-etape-10.sql` puis `supabase/eureka-etape-11.sql` si ces scripts ne sont pas encore installés, redéployer `sorties-enrich` depuis la branche et publier le site.

## Découvertes autour de Nyon

Dans Planification, « Chercher des sorties » lance sur demande une recherche pour l’horizon affiché. Eurêka conserve uniquement les événements datés dans la période dont l’URL a été renvoyée par la recherche web. Les résultats qui correspondent à une fiche existante par source ou par titre et ville sont écartés. « Ajouter au recueil » ouvre une fiche préremplie que l’utilisateur peut enregistrer. La recherche ne transmet aucun titre d’agenda ni détail du recueil, et utilise le plafond IA de l’espace.

Cette fonctionnalité ne nécessite aucun SQL supplémentaire. Pour publier l’ensemble de la branche, vérifier que les étapes 10 et 11 sont appliquées, puis redéployer `sorties-enrich`.

## Lieux de départ

Les fiches ont un lieu de départ dans leur espace. L’étape 12 rattache les fiches existantes à Nyon et ajoute La Saint Cantène et Zermatt à l’espace de Viviane et Nicolas. Chaque compte peut définir son lieu principal. La Planification mémorise le dernier lieu affiché sur l’appareil, comme le sélecteur de caves. Elle filtre le recueil et les découvertes selon ce lieu. Le calendrier garde toutes les sorties de l’espace. Changer l’origine d’une fiche remet à compléter ses durées de trajet.

Appliquer `supabase/eureka-etape-12.sql` après les étapes précédentes, puis redéployer `sorties-enrich` depuis la branche. Claude reçoit la ville et le pays du lieu choisi pour les trajets et les découvertes.

Les découvertes privilégient les agendas locaux proposés dans le panneau « Sources de recherche ». Les éditeurs peuvent y ajouter jusqu’à trois agendas publics par lieu sur leur appareil. « Chercher d’autres sorties » écarte les événements déjà vus. Chaque recherche reste dans le plafond IA de l’espace et seules les pages renvoyées par la recherche web peuvent figurer dans les résultats. Redéployer `sorties-enrich` pour activer ces options.

Dans « Ajouter une idée », la section « Suggestions » lance une recherche à la demande pour le lieu choisi. Elle présente jusqu’à dix idées, y compris des activités permanentes sans date imposée, et exclut les doublons du recueil. Les sites de référence et les sources ajoutées dans Planification sont réutilisés. Pour activer cette recherche, redéployer `sorties-enrich`.
