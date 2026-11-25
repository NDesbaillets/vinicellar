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
