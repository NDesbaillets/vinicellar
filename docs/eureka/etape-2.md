# Eurêka · Étape 2

Le bouton « + » ouvre l’ajout rapide. On peut saisir un texte, coller un lien HTTPS ou joindre jusqu’à cinq photos JPEG, PNG ou WebP de 5 Mo chacune. La création manuelle reste accessible depuis cet écran.

Supabase crée la fiche et l’entrée d’inbox dans la même transaction. Dès l’ouverture de la fiche, son auteur peut suivre la lecture automatique. Si un fournisseur échoue ou si le plafond est atteint, la fiche et les photos restent disponibles. La relance réutilise la même fiche. Une fiche modifiée après sa création conserve les modifications de l’utilisateur.

Les photos restent dans un bucket privé et sont affichées via des URL signées de courte durée. Le premier visuel est la couverture. La fonction analyse surtout cette première photo. Le décodage QR dédié couvre les JPEG et PNG de résolution compatible, avec lecture visuelle par le modèle en complément. Pour Instagram, Apify fournit la légende et la vignette quand elles sont disponibles. L’enrichissement recherche la source officielle et signale les dates dont l’année a dû être déduite.

## Mise en service par le propriétaire

1. Relire puis appliquer [le SQL complémentaire](../../supabase/eureka-etape-2.sql) après le schéma de l’étape 1. Il ajoute les accès de l’inbox, le bucket Eurêka et le registre du budget. Les tables et politiques de la cave et d’ARÔMES sont hors de ce périmètre.
2. Vérifier les secrets existants `ANTHROPIC_API_KEY` et `APIFY_TOKEN` dans Supabase. Renseigner dans les paramètres de la fonction `EUREKA_CLAUDE_MAX_CHF` et `EUREKA_APIFY_MAX_CHF` avec une borne haute par appel, en CHF, calculée selon les tarifs du modèle et de l’acteur utilisés, le change et le coût des recherches web. Anthropic utilise `claude-sonnet-4-6` par défaut, modifiable avec `EUREKA_ANTHROPIC_MODEL`. Pour un essai depuis une autre origine, configurer `EUREKA_ORIGINE` avec l’origine exacte.
3. Déployer `sorties-enrich`, puis vérifier l’ajout depuis l’espace réel avec les comptes autorisés. Configurer le [raccourci iPhone](raccourci-ios.md) sur l’appareil.

## Budget et limites

Avant chaque appel externe, le coût maximal configuré est réservé dans le mois courant (heure de Zurich) et l’appel est inscrit dans `public.ai_calls` avec un type `sorties-*`. Le verrou par espace évite que deux demandes simultanées dépassent le plafond réservé. À partir de 70 %, le suivi de l’ajout affiche une alerte. Une réservation reste comptée si l’appel échoue ou si son coût exact est inférieur. Le registre est donc une estimation prudente, à condition de tenir à jour les bornes configurées.

Les renseignements et l’image externe dépendent des sources accessibles aux fournisseurs. La vidéo d’un reel n’est pas analysée. Si l’exécution d’arrière-plan est interrompue, une relance est disponible depuis la fiche après expiration du bail. Le raccourci transfère le texte ou le lien à l’écran d’ajout. Pour une photo, il utilise le presse-papiers et demande un appui sur « Coller une photo » dans Eurêka.

Vérifié avec Chromium, le SDK Supabase et des réponses HTTP simulées, avec Deno pour les appels fournisseurs simulés, et avec PostgreSQL en mémoire pour les droits de lecture et d’écriture, la relance et le plafond. La fonction et le SQL restent à mettre en service dans le projet Supabase.
