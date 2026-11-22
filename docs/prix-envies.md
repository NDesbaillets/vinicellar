# Alertes de prix (Envies et Vins passés)

Version 1, 22.11.2026.

## Pour l'utilisateur

- **Activer** : dans Envies ou Vins passés, « Surveiller le prix » sous un vin. Un prix cible facultatif se règle en touchant la ligne de surveillance. Pour les Envies, il reprend le prix cible de la liste.
- **Alertes** :
  - prix cible atteint (comparé par bouteille ; magnums et demi-bouteilles ramenés à 75 cl) ;
  - baisse d'au moins X % par rapport au prix habituel (médiane des 60 derniers jours, 15 % par défaut) ;
  - prix barré affiché ;
  - retour en stock.

  Une même alerte n'est pas répétée pour une page pendant 14 jours.
- **Où les voir** : un bandeau sur la Cave, un bloc « Alertes de prix » en tête des Envies, une notification sur l'iPhone ou un e-mail. Les canaux se choisissent dans Compte › Alertes de prix.
- **Sites** : la liste est proposée dans le Compte. Les 13 cavistes suisses sont actifs ; 4 marchands européens sont à activer au besoin. On peut ajouter n'importe quel domaine. Le site du producteur (fiche du vin) est toujours consulté.

## Fonctionnement

1. **Recherche (IA)** : la fonction `watch`, action `discover`, s'en charge.
   - Claude Sonnet 5.5 cherche avec `web_search`, restreint aux domaines choisis, et rend la page produit et le prix par bouteille pour chaque site.
   - Elle a lieu à l'activation, puis une fois par mois.
   - Coût mesuré : environ 0,02 à 0,04 CHF par vin.
2. **Relevé (sans IA)** : `pg_cron` lance la tâche `watch-prices` toutes les heures, à la minute 17.
   - La fonction relit les pages vues il y a plus de 20 h.
   - Le prix est lu par `extract.ts` : balisage schema.org, méta, données JSON de la page, puis texte. On garde le candidat le plus fiable proche du dernier prix connu, et un carton de 6 ou de 12 est ramené à la bouteille.
   - Une page en 404 passe en « disparue ». Trois échecs de lecture la passent en « illisible ».
3. **Plafond** : 2 CHF par utilisateur et par mois pour les recherches (`watch_usage`), réglable par `WATCH_MONTHLY_CHF`. Les relevés ne coûtent rien. Quand le plafond est atteint, les recherches attendent le mois suivant ; les relevés continuent.

## Données (`supabase/watch.sql`)

Tables `watch_prefs`, `watch_sites`, `watches`, `watch_offers`, `watch_prices`, `watch_alerts`, `push_subscriptions` et `watch_usage`. La RLS est activée : chacun ne voit que ses propres lignes. Les relevés sont écrits par la fonction, avec la clé de service.

## Clés

- **Coffre chiffré (Vault)** : la clé du planificateur (`watch_cron_key`) et les clés de notification (`watch_vapid_*`). Elles sont créées côté serveur et lues par `public.watch_config()`, réservée à la clé de service.
- **E-mail** : il faut les secrets de fonction `RESEND_API_KEY` et `WATCH_EMAIL_FROM` (par exemple `Vinicellar <alertes@vinicellar.ch>`, sur un domaine vérifié chez Resend). Sans eux, l'e-mail ne part pas et les notifications fonctionnent seules.

## Limites connues

- Coop refuse les robots : la recherche par l'IA y trouve le prix, mais le relevé nocturne échoue.
- La lecture du prix est générique. Un site au balisage inhabituel peut être lu de travers. Il suffit alors de retirer sa page dans la feuille du vin (la croix).
- Notifications sur iPhone : uniquement depuis l'app installée sur l'écran d'accueil (iOS 16.4 ou plus récent), après « Activer » dans le Compte.
