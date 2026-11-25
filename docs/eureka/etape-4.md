# Eurêka · Étape 4

Depuis **Rappels → Gérer mes agendas iCloud**, le compte lié peut découvrir ses calendriers, choisir ceux à synchroniser et consulter les plages des sept prochains jours. Les calendriers découverts démarrent désactivés. L’activation synchronise les plages occupées. Il faut ensuite autoriser séparément les titres. Un calendrier marqué professionnel reste en mode occupé, et le retrait du consentement efface les titres déjà enregistrés.

Les plages sont privées au compte lié. Viviane voit dans iCloud le calendrier que le propriétaire a partagé avec elle, selon les droits donnés dans iCloud. Le miroir ne lui donne pas accès aux autres calendriers de Nicolas.

## Créneau J3

Les créneaux automatiques démarrent après le choix explicite d’un calendrier actif et modifiable nommé **Eurêka**, d’une heure et d’une durée. J3 propose cette heure à la date de début de l’activité si elle est renseignée. Sinon, il teste les quatorze prochains jours, dans la limite de la date de réservation. Il recherche une plage complète sans chevauchement dans les calendriers activés et revérifie leurs disponibilités auprès d’iCloud avant l’écriture. En l’absence de plage libre ou si une lecture nécessaire échoue, le rappel J3 continue sans créneau.

Le rendez-vous s’intitule « Créneau provisoire Eurêka ». Il ne contient ni titre d’idée ni invité. Le service retire le provisoire quand l’idée est planifiée, réglée ou archivée, ou quand le créneau n’est plus valable. Une modification faite dans iCloud entraîne un conflit visible dans Eurêka et laisse l’événement en place. Un changement de réglages s’applique aux nouveaux créneaux J3. L’éventuel événement définitif reste à créer séparément.

## Mise en service par le propriétaire

1. Créer dans iCloud un calendrier nommé **Eurêka** et le partager manuellement avec Viviane.
2. Relire puis appliquer le [SQL complémentaire](../../supabase/eureka-etape-4.sql) après les étapes précédentes. Renseigner la ligne unique de `public.sorties_liaison_icloud` avec les UUID vérifiés de l’espace et de Nicolas, déjà désigné comme destinataire principal à l’étape 3.
3. Générer dans le compte Apple un mot de passe d’application. Le saisir dans les secrets Supabase sous `EUREKA_ICLOUD_APP_PASSWORD`, avec l’identifiant du compte sous `EUREKA_ICLOUD_APPLE_ID`. Configurer une valeur aléatoire commune sous `EUREKA_ICLOUD_CRON_SECRET` côté Edge et `eureka_icloud_cron_secret` dans Vault. Dans Vault, renseigner `eureka_icloud_url` avec l’URL Supabase de `sorties-calendrier`.
4. Déployer `sorties-calendrier` avec `--no-verify-jwt`. La fonction vérifie le jeton Supabase sur les appels de l’interface et le secret sur ceux du cron. Pour un test depuis une autre origine, configurer exactement `EUREKA_ORIGINE`.
5. Dans Eurêka, lancer la découverte et activer les calendriers souhaités. Identifier les calendriers professionnels avant d’autoriser des titres. Choisir ensuite le calendrier d’écriture, l’heure et la durée des créneaux J3.

Le cron est enregistré toutes les quinze minutes. Il reste inactif sans liaison et secrets Vault. Les instantanés couvrent environ trois mois et les calendriers actifs sont relus environ toutes les 45 minutes. Le journal `ai_calls` conserve le type et le résultat des appels CalDAV, avec un plafond de 20 000 requêtes par mois pour la liaison. Les appels iCloud ne consomment pas de budget IA. Le miroir accepte jusqu’à douze calendriers actifs et repose sur l’expansion des récurrences par le serveur CalDAV.

## Vérifications

SQL et isolation vérifiés dans PostgreSQL en mémoire. Tests Deno avec iCloud simulé, dont absence de lecture d’événements à la découverte, suppression des titres au retrait du consentement, changement d’heure, contrôle du calendrier d’écriture, blocage en cas de chevauchement et retrait conditionnel. Parcours de réglage et de lecture vérifiés dans Chromium à 390 px.

Le comportement avec le compte Apple réel reste à vérifier. Aucun agenda réel n’a été consulté ou modifié et aucun changement n’a été appliqué à Supabase.
