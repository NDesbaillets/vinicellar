# Eurêka · Étape 1

## Disponible

- Application statique installable sous `/eureka/`, manifeste, icônes et service worker dédiés. Hors connexion, le service worker affiche une page de secours. Les données privées restent hors du cache.
- Session Supabase partagée et sélection d’un espace depuis les appartenances du compte. Le rôle lecteur dispose de la consultation.
- Accueil Atelier avec cartes, recherche plein texte française sans accents, repli trigramme, filtres cumulables, tri et « Surprends-moi ».
- Fiche avec lieu et carte sur demande, réservation, téléphone, budget, dates, options, scores individuels et score couple. Création manuelle et modification d’une idée, changement de statut, planification, notes et proposition de la prochaine date pour une sortie récurrente.
- Vérifications dans Chromium à 390 px et sur bureau, avec le SDK Supabase et des réponses HTTP fictives locales. Les tests du dépôt ont également été lancés. Aucune donnée de test n’a été écrite dans Supabase.

## Reste à faire

- Valider les parcours connectés avec les comptes et les politiques de l’espace réel.
- Étapes suivantes du cadrage, dont l’ajout rapide et l’enrichissement, puis les rappels et les agendas.

Les limitations de retour après connexion, de recherche, de visuels privés et de planification sont détaillées dans [Écarts de l’étape 1](ecarts.md).
