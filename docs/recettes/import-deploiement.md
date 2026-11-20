# ARÔMES V&N · Phase 2 · Déploiement de l'import

Pas à pas pour le propriétaire du projet. Contrat : `02-import-contrat.md`. Rien de ceci n'est appliqué tant que vous ne l'avez pas fait vous-même ; l'ordre compte.

## 1. Créer les secrets

Supabase > projet « vinicellar » > Edge Functions > Secrets (ou `supabase secrets set NOM=valeur`).

| Secret | Où l'obtenir | Statut |
|---|---|---|
| `ANTHROPIC_API_KEY` | déjà utilisé par `sommelier` et `identify` | existe |
| `APIFY_TOKEN` | console.apify.com > Settings > API & Integrations > Personal API token | à créer |
| `GEMINI_API_KEY` | aistudio.google.com > Get API key (clé « Gemini API ») | à créer |

Facultatifs (valeurs par défaut entre parenthèses) : `RECIPE_IMPORT_DAILY_LIMIT` (50), `RECIPE_IMPORT_MAX_SECONDS` (380, plan Pro), `GEMINI_MODEL` (`gemini-flash-latest`), `GEMINI_FALLBACK_MODEL` (`gemini-2.5-flash`).

Fixez un plafond de dépense mensuel sur Apify, Google AI Studio et Anthropic avant d'ouvrir l'import à d'autres personnes.

## 2. Appliquer la migration

1. Supabase > SQL Editor > coller le contenu de `supabase/recettes-phase2.sql` > Run. La phase 1 (`recettes.sql`) doit déjà être appliquée. Le fichier est rejouable.
2. Contrôles rapides :
   - Table Editor : `recipe_imports` existe, RLS activée.
   - Storage : bucket privé `recipe-videos`. Si l'import de vidéos de plus de 50 Mo échoue, vérifier Storage > Settings > « Global file size limit » (le plan gratuit plafonne à 50 Mo quel que soit le bucket ; un reel d'une minute pèse en général 5 à 30 Mo).
   - Database > Publications > `supabase_realtime` contient `recipe_imports`.

## 3. Déployer la fonction

```bash
supabase functions deploy recipe-import --project-ref <réf du projet>
```

Ne pas passer `--no-verify-jwt` : la vérification du JWT par la passerelle doit rester active (la fonction revérifie aussi le jeton et l'appartenance au carnet). Le dossier contient `index.ts`, `lib.ts` (fonctions pures) et `lib_test.ts` (tests, non déployé utilement mais sans effet).

Durée d'exécution : un import tourne en arrière-plan après la réponse `202`. La plateforme coupe une fonction au bout de son délai maximal (environ 150 s sur le plan gratuit, environ 400 s sur un plan payant, à vérifier dans Edge Functions > Limits). La fonction s'arrête d'elle-même après `RECIPE_IMPORT_MAX_SECONDS` (380 par défaut, adapté au plan Pro, ce qui laisse les relances Gemini de 5 s, 15 s et 30 s aller au bout). Sur le plan gratuit, fixer `RECIPE_IMPORT_MAX_SECONDS=140`. Un import coupé par la plateforme reste « en cours » ; il passe en « echec » (« Import interrompu ») au prochain import de n'importe qui, après 10 minutes, et peut être relancé.

## 4. Tester avec un reel

1. Ouvrir `https://vinicellar.ch/recettes/ajouter.html`, connecté, coller un lien de reel (par exemple `https://www.instagram.com/p/DbaXl9DNHsp/`), choisir un carnet, lancer.
2. La liste « En cours » doit afficher successivement « Récupération du reel », « Lecture de la vidéo » (seulement si la légende ne suffit pas), « Rédaction de la fiche », « Rattachement des ingrédients », « Vérification des doublons », « Enregistrement de la fiche », puis un lien vers la fiche (statut « À vérifier » avec ses alertes).
3. Sans interface, avec un jeton de session (`supabase.auth.getSession()` dans la console du navigateur) et une ligne `recipe_imports` déjà créée :

```bash
curl -i -X POST 'https://<réf>.supabase.co/functions/v1/recipe-import' \
  -H 'Authorization: Bearer <jwt utilisateur>' -H 'apikey: <clé anon>' \
  -H 'Content-Type: application/json' -d '{"import_id":"<uuid de la ligne>"}'
# attendu : 202 {"status":"en_cours"}
```

4. Journaux : Edge Functions > recipe-import > Logs (lignes `usage`, `gemini usage`, `gemini status`). Les clés ne sont jamais écrites dans les journaux.
5. Quota : `select count(*) from ai_calls where kind = 'recipe-import' and user_id = '<uuid>' and created_at > now() - interval '24 hours'`.

Codes de retour synchrones : `400` (lien ou photos invalides), `401` (session), `403` (pas éditeur du carnet), `404` (import introuvable ou d'un autre), `409` (déjà en cours ou terminé), `429` (50 imports par 24 h), `503` (secret Anthropic absent). Les erreurs d'import arrivent ensuite dans `recipe_imports.error`, en français. Une ligne en « echec » peut être relancée en rappelant la fonction avec le même `import_id`.

## 5. Coûts attendus

Ordre de grandeur par import, à confirmer sur vos tableaux de bord de facturation après quelques essais (les tarifs changent) :

| Poste | Reel avec vidéo analysée | Reel dont la légende suffit | Page web | Photo de page |
|---|---|---|---|---|
| Apify (reel scraper) | quelques dixièmes de centime | idem | aucun | aucun |
| Gemini (vidéo, environ 1 minute) | environ 0,5 à 1 centime | aucun | aucun | aucun |
| Claude (structuration, plus triage) | environ 1,5 à 2 centimes | environ 1 à 1,5 centime | environ 1 à 2 centimes | environ 2 à 3 centimes |
| Total | environ 2 à 3 centimes | environ 1,5 centime | environ 1 à 2 centimes | environ 2 à 3 centimes |

Au maximum permis (50 imports par personne et par jour), cela représente de l'ordre de 1 à 1,50 franc par personne et par jour. Le catalogue d'ingrédients est envoyé à Claude dans un bloc mis en cache : le coût baisse quand les imports se suivent.

## 6. Limites connues

- Instagram : seuls les posts et reels publics sont lisibles ; un compte privé ou un contenu supprimé échoue avec « Reel introuvable ». Apify dépend d'Instagram et peut échouer par moments : une relance automatique a lieu, puis l'import passe en échec.
- Vidéo : téléchargée jusqu'à 100 Mo et 10 minutes ; au-delà, la fiche repose sur la légende seule, avec une alerte. Conservée 30 jours dans `recipe-videos`, puis supprimée lors d'un import ultérieur (nettoyage opportuniste : sans nouvel import, les fichiers restent ; une tâche planifiée pourra remplacer cela plus tard).
- Gemini : 3 relances (5 s, 15 s, 30 s) sur 429/500/503, puis le modèle de repli. Si la vidéo reste inanalysable mais que la légende dépasse 40 caractères, la fiche est créée sur la légende avec une alerte ; sinon l'import échoue.
- Web : page de 3 Mo au plus, 15 s de délai, 60 000 caractères de texte. Les pages chargées par JavaScript, derrière un mur de connexion ou un bouclier anti-robot ne sont pas lisibles. Les adresses privées (localhost, réseaux internes) sont refusées. Pas d'image récupérée depuis un site web.
- Photo de page : 4 photos, 5 Mo chacune au maximum (le front les compresse à 2000 px). Une écriture manuscrite difficile donne des alertes et une fiche partielle ; l'import se termine en `a_relire` (l'auteur peut supprimer la ligne d'import).
- Conversions : les températures °F, oz, lb, sticks, fl oz, pints, quarts et gallons sont converties de façon fixe. Les cups sont converties en grammes seulement si l'ingrédient a une densité dans le catalogue et n'est pas un liquide ; sinon en ml avec une alerte « Converti ». Aucune table de densités n'est embarquée : il faut renseigner `density_g_per_ml` dans le catalogue (SQL Editor) pour les ingrédients courants (farine, sucre, beurre, etc.).
- Catalogue : un ingrédient inconnu est ajouté avec `validated = false` (60 au plus par import) ; il reste à valider et à compléter (rayon, saisons, allergènes, densité).
- Doublons : comparés dans tous les carnets de la personne (même lien, titre voisin, ou même auteur avec au moins 60 % d'ingrédients du catalogue en commun). La fiche est toujours créée ; `duplicate_of` et une alerte signalent le doublon.
- Sécurité : les contenus importés (légende, transcription, page, image) sont traités comme des données, jamais comme des instructions ; la réponse de Claude est validée champ par champ avant écriture. Les clés Apify, Gemini et Anthropic ne quittent jamais la fonction.
