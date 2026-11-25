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
