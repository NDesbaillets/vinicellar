# Eurêka · Étape 3

L’onglet **Rappels** réunit les échéances personnelles, les suggestions, les demandes de suivi à traiter et les réglages. Les notifications sont activables par appareil. Sur iPhone, ouvrir Eurêka depuis l’écran d’accueil après l’y avoir ajouté.

- L’échelle J0, J3, J7 et J10 commence à la date de réservation limite, ou à la date de début, moins le préavis. J3 affiche un compte à rebours dans l’app. J7 privilégie l’e-mail et J10 peut l’utiliser en secours. Au plus deux rappels par jour et par personne sont mis en file, tous espaces et canaux confondus, aux heures suisses configurées.
- Une réservation confirmée, une planification ou l’archivage arrête les rappels. Une idée devient « Manquée » le lendemain suisse d’un dernier rappel livré et resté sans réponse. Après une interruption ou une limite quotidienne, le système reprend à la phase échue la plus récente. Sans livraison de J10 à un fournisseur, l’idée reste active.
- Les suggestions sans échéance affichent les critères du classement. « Non » reporte de trois jours. Un report explicite peut durer trois jours, une semaine ou deux semaines. Après deux reports, Eurêka demande si l’idée reste d’actualité et permet de l’archiver ou de baisser son urgence.
- Une demande de suivi se fait sur la fiche. Le destinataire principal décide idée par idée. Si le suivi est accepté au moment de J7, le membre qui suit peut recevoir un message distinct, sans détail du rappel privé. Le retrait ou la révocation bloque les envois encore en attente. Le suivi ne donne aucun accès à l’historique du destinataire principal.

## Mise en service par le propriétaire

1. Relire puis appliquer le [SQL complémentaire](../../supabase/eureka-etape-3.sql). Le projet doit disposer de `pg_cron`, `pg_net` et Vault. Les tables et politiques de la cave et d’ARÔMES restent hors du périmètre.
2. Désigner Nicolas comme destinataire principal dans `public.sorties_destinataires_rappel`. Utiliser les UUID vérifiés de l’espace et de son compte Supabase Auth. Cet utilisateur doit avoir le rôle `owner` ou `membre` de l’espace. Tant qu’aucun destinataire principal n’est désigné, l’espace ne produit aucun rappel.
3. Configurer `EUREKA_NOTIFY_SECRET` dans les secrets Edge et la même valeur dans le secret Vault `eureka_notify_secret`. Dans Vault, renseigner aussi `eureka_notify_url` avec l’URL Supabase complète de la fonction `sorties-notify`. Le job `eureka-rappels` s’exécute chaque minute et reste inactif tant que ces deux entrées manquent.
4. Déployer `sorties-notify` avec `--no-verify-jwt`. La fonction vérifie elle-même le secret du cron. Réutiliser `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT` du projet. Pour les e-mails J7 et le secours J10, vérifier `RESEND_API_KEY` et un expéditeur validé dans `EUREKA_EMAIL_FROM` ou `WATCH_EMAIL_FROM`.
5. Valider avec des comptes et appareils autorisés. Vérifier séparément le rappel du destinataire principal, le suivi accepté, la révocation et le canal e-mail.

## Vérifications et limites

Le planificateur et les droits ont été vérifiés dans PostgreSQL en mémoire. Les livraisons push et e-mail ont été simulées sous Deno, et les parcours de réglage, report et consentement ont été vérifiés dans Chromium. Aucun SQL n’a été appliqué au projet, aucune fonction n’a été déployée et aucun message réel n’a été envoyé.

Les actions d’une notification ouvrent le rappel correspondant pour confirmation dans l’app. L’affichage des boutons sur l’écran verrouillé dépend du navigateur. L’e-mail nécessite un fournisseur configuré et une adresse confirmée. Le créneau iCloud provisoire de J3 reste à l’étape 4.
