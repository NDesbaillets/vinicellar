-- ARÔMES V&N · phase 4 « Suggérer » : profils, retours « Pas cette fois / Jamais », moteur de suggestions,
-- « Avec ce que j'ai ».
-- Rejouable (idempotent). À exécuter dans Supabase > SQL Editor, APRÈS recettes.sql et recettes-phase3.sql.
-- Contrat : docs/recettes/04-suggerer-contrat.md. Ne modifie aucune table ni fonction existante (cave ou recettes) :
-- tout est nouveau et préfixé recipe_ / recipe_… ; la RLS est activée dès la création des tables.

-- ---------------------------------------------------------------- profil par personne
-- Un profil par utilisateur, privé : lui seul lit et écrit sa ligne. Les autres membres de ses carnets ne voient
-- que allergies, aversions et régime, et seulement par book_people_profiles() (pas la difficulté acceptée).
create table if not exists public.recipe_profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  -- 14 allergènes de l'UE, mêmes codes que recipe_ingredients_catalog.allergens
  allergens text[] not null default '{}'
    check (allergens <@ array['gluten','crustaces','oeufs','poisson','arachides','soja','lait','fruits_a_coque',
                              'celeri','moutarde','sesame','sulfites','lupin','mollusques']::text[]),
  aversions uuid[] not null default '{}' check (cardinality(aversions) <= 200),        -- ids du catalogue d'ingrédients
  aversions_texte text[] not null default '{}' check (cardinality(aversions_texte) <= 50),  -- aversions hors catalogue
  regime text check (regime in ('omnivore','flexitarien','vegetarien','vegan','pescetarien','sans_gluten','sans_lactose')),
  difficulte_semaine smallint check (difficulte_semaine between 1 and 3),             -- difficulté max acceptée en semaine
  updated_at timestamptz not null default now()
);

alter table public.recipe_profiles enable row level security;

drop policy if exists "own profile read" on public.recipe_profiles;
create policy "own profile read" on public.recipe_profiles for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own profile insert" on public.recipe_profiles;
create policy "own profile insert" on public.recipe_profiles for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "own profile update" on public.recipe_profiles;
create policy "own profile update" on public.recipe_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own profile delete" on public.recipe_profiles;
create policy "own profile delete" on public.recipe_profiles for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.recipe_profiles_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.recipe_profiles_touch() from anon, authenticated, public;

drop trigger if exists recipe_profiles_touch on public.recipe_profiles;
create trigger recipe_profiles_touch before insert or update on public.recipe_profiles
  for each row execute function public.recipe_profiles_touch();

-- Contraintes alimentaires des membres d'un carnet, pour « Pour qui ? ». Réservé aux membres du carnet ;
-- ne renvoie que les personnes membres de ce carnet, et jamais la difficulté acceptée en semaine.
create or replace function public.book_people_profiles(b uuid)
returns table (user_id uuid, allergens text[], aversions uuid[], aversions_texte text[], regime text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.allergens, p.aversions, p.aversions_texte, p.regime
    from recipe_book_members m
    join recipe_profiles p on p.user_id = m.user_id
   where m.book_id = b and public.is_book_member(b)
$$;

-- ---------------------------------------------------------------- retours sur les suggestions
-- « Pas cette fois » masque la recette 14 jours ; « Jamais » la masque définitivement (annulable : suppression
-- de la ligne). Une ligne par personne et par recette ; un nouveau choix remplace l'ancien (upsert).
create table if not exists public.recipe_feedback (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id uuid not null references public.recipes on delete cascade,
  kind text not null check (kind in ('pas_cette_fois','jamais')),
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);
create index if not exists recipe_feedback_recipe_idx on public.recipe_feedback (recipe_id);

alter table public.recipe_feedback enable row level security;

drop policy if exists "own feedback read" on public.recipe_feedback;
create policy "own feedback read" on public.recipe_feedback for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own feedback insert" on public.recipe_feedback;
create policy "own feedback insert" on public.recipe_feedback for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_book_member(public.recipe_book_id(recipe_id)));
drop policy if exists "own feedback update" on public.recipe_feedback;
create policy "own feedback update" on public.recipe_feedback for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own feedback delete" on public.recipe_feedback;
create policy "own feedback delete" on public.recipe_feedback for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- suggestions
-- Score sur 100, poids fixes (cadrage §4) :
--   saison   35 : part des ingrédients saisonniers du catalogue (1 à 11 mois de saison ; hors « optional ») qui sont de saison au mois
--                 donné, lissée (in + 0,5) / (saisonniers + 1) ; sans ingrédient saisonnier : 0,5 (neutre).
--                 Bonus +0,25 (plafonné à 1) si un ingrédient `short_season` est de saison.
--   goûts    30 : note moyenne des cuissons des utilisateurs visés, (moyenne - 1) / 4 ; jamais notée par eux : 0,5.
--   variété  20 : jours depuis la dernière cuisson (par n'importe quel membre du carnet), plafonné à 90, / 90 ;
--                 jamais cuisinée : 0,7 (bonus modéré).
--   facilité 15 : en semaine, 0,6 x rapidité (temps total : 30 min ou moins = 1, 120 min ou plus = 0, inconnu 0,5)
--                 + 0,4 x simplicité (difficulté 1 = 1, 2 = 0,5, 3 = 0, inconnue = 0,5 ; 0 si au-dessus de la
--                 `difficulte_semaine` de l'appelant). Le week-end : 0,5 pour tous (neutre).
-- Exclusions strictes : recette supprimée, archivée ou « à vérifier » ; allergène, aversion (catalogue ou texte) ou
-- régime incompatible, pour l'un quelconque des utilisateurs visés ; retour actif de l'appelant.
-- Régimes (via allergènes et rayons du catalogue) : vegetarien = ni boucherie/poissonnerie ni poisson, crustacés,
-- mollusques ; pescetarien = pas de boucherie ; vegan = végétarien + pas de crémerie, lait, oeufs ;
-- sans_gluten = pas de gluten ; sans_lactose = pas de lait ; omnivore et flexitarien : aucune exclusion.
-- Les lignes sans ingrédient du catalogue ne peuvent être contrôlées que par les aversions en texte.
--
-- security invoker : la RLS filtre les recettes, lignes et cuissons. Les profils des autres personnes passent par
-- book_people_profiles() (membres du même carnet) ; p_for_users vide ou null = l'appelant seul.
create or replace function public.recipe_suggestions(
  p_book_ids uuid[],
  p_for_users uuid[] default null,
  p_month int default extract(month from (now() at time zone 'Europe/Zurich'))::int,
  p_limit int default 12,
  p_weekday boolean default (extract(isodow from (now() at time zone 'Europe/Zurich')) <= 5)
)
returns table (recipe_id uuid, score numeric, raisons text[])
language plpgsql stable security invoker set search_path = public as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  users uuid[];
  lim int := least(greatest(coalesce(p_limit, 12), 1), 100);
  today date := (now() at time zone 'Europe/Zurich')::date;
begin
  if me is null then return; end if;
  if p_month is null or p_month not between 1 and 12 then raise exception 'mois invalide'; end if;
  if p_book_ids is null or cardinality(p_book_ids) = 0 then return; end if;
  users := coalesce(nullif(p_for_users, '{}'), array[me]);

  return query
  with tg as (
    select distinct on (x.user_id) x.user_id, x.allergens, x.aversions, x.aversions_texte, x.regime, x.difficulte_semaine
      from (
        select p.user_id, p.allergens, p.aversions, p.aversions_texte, p.regime, p.difficulte_semaine
          from recipe_profiles p where p.user_id = me and me = any(users)
        union all
        select b.user_id, b.allergens, b.aversions, b.aversions_texte, b.regime, null::smallint
          from unnest(p_book_ids) bk cross join lateral public.book_people_profiles(bk) b
         where b.user_id = any(users)
      ) x
     order by x.user_id, (x.difficulte_semaine is null)
  ),
  fa as (
    select
      (select coalesce(array_agg(distinct a), '{}') from (
         select unnest(allergens) a from tg
         union select 'gluten' from tg where regime = 'sans_gluten'
         union select 'lait' from tg where regime in ('sans_lactose', 'vegan')
         union select 'oeufs' from tg where regime = 'vegan'
         union select unnest(array['poisson', 'crustaces', 'mollusques']) from tg where regime in ('vegetarien', 'vegan')) s) as f_allerg,
      (select coalesce(array_agg(distinct a), '{}') from (
         select 'boucherie' a from tg where regime in ('vegetarien', 'vegan', 'pescetarien')
         union select 'poissonnerie' from tg where regime in ('vegetarien', 'vegan')
         union select 'cremerie' from tg where regime = 'vegan') s) as f_aisles,
      (select coalesce(array_agg(distinct a), '{}') from (select unnest(aversions) a from tg) s) as f_avers,
      (select coalesce(array_agg(distinct lower(trim(a))), '{}') from (select unnest(aversions_texte) a from tg) s
        where length(trim(a)) >= 3) as f_avtxt,
      (select min(difficulte_semaine) from tg where user_id = me) as diff_max
  ),
  cand as (
    select r.id, r.difficulty, r.time_total_min
      from recipes r
     where r.book_id = any(p_book_ids)
       and r.deleted_at is null and r.archived_at is null and r.review_state = 'valide'
       and not exists (select 1 from recipe_feedback f
                        where f.user_id = me and f.recipe_id = r.id
                          and (f.kind = 'jamais' or f.created_at > now() - interval '14 days'))
  ),
  ln as (
    select c.id as rid, l.catalog_id, l.optional, l.label_original,
           ic.name, ic.allergens, ic.aisle, ic.season_months, ic.short_season
      from cand c
      join recipe_ingredient_lines l on l.recipe_id = c.id
      left join recipe_ingredients_catalog ic on ic.id = l.catalog_id
  ),
  excluded as (
    select distinct rid from ln cross join fa
     where ln.allergens && fa.f_allerg
        or ln.aisle = any(fa.f_aisles)
        or ln.catalog_id = any(fa.f_avers)
        or exists (select 1 from unnest(fa.f_avtxt) t
                    where strpos(public.f_unaccent(lower(label_original)), public.f_unaccent(t)) > 0)
  ),
  seas as (
    select rid,
           count(*) filter (where cardinality(season_months) between 1 and 11) as tagged,
           count(*) filter (where cardinality(season_months) between 1 and 11 and p_month = any(season_months)) as ins,
           coalesce(bool_or(short_season and p_month = any(season_months)), false) as short_in,
           array_agg(name order by short_season desc, name) filter (where cardinality(season_months) between 1 and 11 and p_month = any(season_months)) as in_names
      from (select distinct rid, catalog_id, name, season_months, short_season
              from ln where catalog_id is not null and not optional) d
     group by rid
  ),
  ck as (
    select k.recipe_id as rid,
           max(k.cooked_on) as last_on,
           avg(k.rating) filter (where k.cooked_by = any(users)) as avg_r
      from recipe_cooks k
     where k.recipe_id in (select id from cand)
     group by k.recipe_id
  ),
  base as (
    select c.id as rid, c.difficulty, c.time_total_min,
           coalesce(s.tagged, 0) as tagged, coalesce(s.ins, 0) as ins, coalesce(s.short_in, false) as short_in, s.in_names,
           k.last_on, k.avg_r,
           case when k.last_on is null then null else greatest(0, today - k.last_on) end as days
      from cand c
      left join seas s on s.rid = c.id
      left join ck k on k.rid = c.id
     where c.id not in (select rid from excluded)
  ),
  sc as (
    select b.*,
      35 * least(1, (b.ins + 0.5) / (b.tagged + 1) + case when b.short_in then 0.25 else 0 end) as p_saison,
      30 * case when b.avg_r is null then 0.5 else (b.avg_r - 1) / 4 end as p_gouts,
      20 * case when b.days is null then 0.7 else least(b.days, 90) / 90.0 end as p_variete,
      15 * case when p_weekday then
             0.6 * case when b.time_total_min is null then 0.5
                        else greatest(0, least(1, 1 - (b.time_total_min - 30) / 90.0)) end
           + 0.4 * case when fa.diff_max is not null and b.difficulty > fa.diff_max then 0
                        else (3 - coalesce(b.difficulty, 2)) / 2.0 end
           else 0.5 end as p_facilite
      from base b cross join fa
  )
  select s.rid,
         round((s.p_saison + s.p_gouts + s.p_variete + s.p_facilite)::numeric, 1),
         array_remove(array[
           case when s.ins > 0 and s.in_names is not null and s.ins::numeric / nullif(s.tagged, 0) >= 0.5
                then 'De saison : ' || array_to_string(s.in_names[1:3], ', ') end,
           case
             when s.avg_r >= 4 then
               'Noté ' || replace(round(s.avg_r, 1)::float8::text, '.', ',') || '/5'
               || case when s.days >= 28 then ', pas refait depuis ' || ago.t else '' end
             when s.last_on is null then 'Pas encore essayée'
             when s.days >= 28 then 'Pas refaite depuis ' || ago.t
           end,
           case when s.time_total_min between 1 and 40 then 'Prête en ' || s.time_total_min || ' min'
                when s.time_total_min is null and s.difficulty = 1 then 'Facile à réaliser' end
         ], null)::text[]
    from sc s
    cross join lateral (select case when s.days is null then null
                                    when s.days < 14 then s.days || ' jours'
                                    when s.days < 70 then (s.days / 7) || ' semaines'
                                    else (s.days / 30) || ' mois' end as t) ago
   order by 2 desc, s.rid
   limit lim;
end $$;

-- ---------------------------------------------------------------- « Avec ce que j'ai »
-- Recettes classées par nombre d'ingrédients du catalogue manquants (croissant). Ne comptent pas : lignes
-- `optional`, rayon « epices », sel, poivre, huile, eau. Doit contenir au moins un ingrédient que l'on a.
-- uncatalogued_count : lignes non optionnelles sans ingrédient du catalogue (non évaluables, départage à égalité).
create or replace function public.recipe_with_what_i_have(p_book_ids uuid[], p_catalog_ids uuid[], p_limit int default 20)
returns table (recipe_id uuid, missing_count int, needed_count int, missing_ids uuid[], missing_names text[], uncatalogued_count int)
language plpgsql stable security invoker set search_path = public as $$
#variable_conflict use_column
declare
  have uuid[] := coalesce(p_catalog_ids, '{}');
  lim int := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if auth.uid() is null or p_book_ids is null or cardinality(have) = 0 then return; end if;
  return query
  with cand as (
    select r.id from recipes r
     where r.book_id = any(p_book_ids)
       and r.deleted_at is null and r.archived_at is null and r.review_state = 'valide'
  ),
  need as (
    select distinct c.id as rid, ic.id as cid, ic.name
      from cand c
      join recipe_ingredient_lines l on l.recipe_id = c.id and not l.optional
      join recipe_ingredients_catalog ic on ic.id = l.catalog_id
     where ic.aisle <> 'epices'
       and public.f_unaccent(lower(ic.name)) !~ '^(sel|gros sel|sel fin|fleur de sel|poivre.*|eau|eau froide|eau chaude|eau tiede|huile.*)$'
  ),
  agg as (
    select rid,
           count(*)::int as needed,
           count(*) filter (where not cid = any(have))::int as miss,
           coalesce(array_agg(cid order by name) filter (where not cid = any(have)), '{}') as miss_ids,
           coalesce(array_agg(name order by name) filter (where not cid = any(have)), '{}') as miss_names
      from need group by rid
  ),
  unc as (
    select l.recipe_id as rid, count(*)::int as n
      from recipe_ingredient_lines l
     where l.recipe_id in (select id from cand) and l.catalog_id is null and not l.optional
     group by l.recipe_id
  )
  select a.rid, a.miss, a.needed, a.miss_ids, a.miss_names, coalesce(u.n, 0)
    from agg a left join unc u on u.rid = a.rid
   where a.needed - a.miss >= 1
   order by a.miss, coalesce(u.n, 0), (a.needed - a.miss) desc, a.rid
   limit lim;
end $$;

-- ---------------------------------------------------------------- recherche filtrée (langage naturel)
-- Exécute les filtres produits par l'edge function recipe-search (Claude traduit la question, cette fonction la
-- exécute) ; utilisable aussi telle quelle par le front pour la recherche à filtres. security invoker : la RLS
-- limite aux carnets de l'appelant. Tous les filtres sont optionnels (null ou vide = ignoré).
--   p_texte : texte libre, tolérant aux accents (websearch français sur `search`) et aux fautes (trigrammes sur le
--             titre, word_similarity >= 0,35)
--   p_course : entree | plat | dessert | accompagnement | boisson | autre
--   p_inc / p_exc : ids du catalogue à avoir / à ne pas avoir ; p_inc_txt / p_exc_txt : mêmes contraintes en texte
--             libre sur le libellé d'origine des lignes (ingrédients que le catalogue ne reconnaît pas)
--   p_month : « de saison » = au moins un ingrédient saisonnier de saison et au moins la moitié des
--             ingrédients saisonniers (hors « optional ») de saison à ce mois
--   p_regime : vegetarien | vegan | pescetarien | sans_gluten | sans_lactose (mêmes règles que les suggestions)
create or replace function public.recipe_search(
  p_book_ids uuid[],
  p_texte text default null,
  p_course text default null,
  p_cuisine text default null,
  p_time_max int default null,
  p_diff_max int default null,
  p_inc uuid[] default null,
  p_exc uuid[] default null,
  p_inc_txt text[] default null,
  p_exc_txt text[] default null,
  p_month int default null,
  p_regime text default null,
  p_limit int default 30
)
returns table (recipe_id uuid, book_id uuid, title text, course text, cuisine text, time_total_min int,
               difficulty smallint, servings int, family boolean, review_state text, rank real)
language plpgsql stable security invoker set search_path = public as $$
#variable_conflict use_column
declare
  q text := nullif(trim(public.f_unaccent(lower(coalesce(p_texte, '')))), '');
  tsq tsquery;
  cu text := nullif(trim(public.f_unaccent(lower(coalesce(p_cuisine, '')))), '');
  f_allerg text[] := '{}';
  f_aisles text[] := '{}';
  lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if auth.uid() is null or p_book_ids is null or cardinality(p_book_ids) = 0 then return; end if;
  if q is not null then tsq := websearch_to_tsquery('french', q); end if;
  f_allerg := case p_regime
    when 'sans_gluten' then array['gluten']
    when 'sans_lactose' then array['lait']
    when 'vegetarien' then array['poisson', 'crustaces', 'mollusques']
    when 'vegan' then array['poisson', 'crustaces', 'mollusques', 'lait', 'oeufs']
    else '{}' end;
  f_aisles := case p_regime
    when 'pescetarien' then array['boucherie']
    when 'vegetarien' then array['boucherie', 'poissonnerie']
    when 'vegan' then array['boucherie', 'poissonnerie', 'cremerie']
    else '{}' end;

  return query
  select r.id, r.book_id, r.title, r.course, r.cuisine, r.time_total_min, r.difficulty, r.servings, r.family, r.review_state,
         case when q is null then 0::real
              else (coalesce(ts_rank(r.search, tsq), 0)
                    + extensions.word_similarity(q, public.f_unaccent(lower(r.title))))::real end as rank
    from recipes r
   where r.book_id = any(p_book_ids)
     and r.deleted_at is null and r.archived_at is null
     and (p_course is null or r.course = p_course)
     and (cu is null or strpos(public.f_unaccent(lower(coalesce(r.cuisine, ''))), cu) > 0)
     and (p_time_max is null or r.time_total_min <= p_time_max)
     and (p_diff_max is null or r.difficulty <= p_diff_max)
     and (q is null
          or (tsq is not null and r.search @@ tsq)
          or extensions.word_similarity(q, public.f_unaccent(lower(r.title))) >= 0.35)
     and not exists (select 1 from unnest(coalesce(p_inc, '{}')) i
                      where not exists (select 1 from recipe_ingredient_lines l where l.recipe_id = r.id and l.catalog_id = i))
     and not exists (select 1 from unnest(coalesce(p_inc_txt, '{}')) t
                      where length(trim(t)) >= 2 and not exists (
                        select 1 from recipe_ingredient_lines l
                         where l.recipe_id = r.id
                           and strpos(public.f_unaccent(lower(l.label_original)), public.f_unaccent(lower(trim(t)))) > 0))
     and not exists (select 1 from recipe_ingredient_lines l
                      where l.recipe_id = r.id and l.catalog_id = any(coalesce(p_exc, '{}')))
     and not exists (select 1 from recipe_ingredient_lines l, unnest(coalesce(p_exc_txt, '{}')) t
                      where l.recipe_id = r.id and length(trim(t)) >= 2
                        and strpos(public.f_unaccent(lower(l.label_original)), public.f_unaccent(lower(trim(t)))) > 0)
     and (cardinality(f_allerg) = 0 and cardinality(f_aisles) = 0
          or not exists (select 1 from recipe_ingredient_lines l
                           join recipe_ingredients_catalog ic on ic.id = l.catalog_id
                          where l.recipe_id = r.id and (ic.allergens && f_allerg or ic.aisle = any(f_aisles))))
     and (p_month is null or exists (
            select 1 from (
              select count(*) filter (where cardinality(ic.season_months) between 1 and 11) as tagged,
                     count(*) filter (where cardinality(ic.season_months) between 1 and 11 and p_month = any(ic.season_months)) as ins
                from (select distinct l.catalog_id from recipe_ingredient_lines l
                       where l.recipe_id = r.id and l.catalog_id is not null and not l.optional) d
                join recipe_ingredients_catalog ic on ic.id = d.catalog_id) z
             where z.ins > 0 and z.ins::numeric / z.tagged >= 0.5))
   order by 11 desc, r.created_at desc, r.id
   limit lim;
end $$;

-- ---------------------------------------------------------------- index
-- Les index utiles à ces requêtes (lignes par recette, cuissons par recette, recettes par carnet) existent déjà
-- (recettes.sql, phase 3). Seul recipe_feedback en reçoit un, plus haut. Pour le tri des retours récents :
create index if not exists recipe_feedback_user_kind_idx on public.recipe_feedback (user_id, kind, created_at desc);

-- ---------------------------------------------------------------- droits
revoke execute on function public.book_people_profiles(uuid), public.recipe_suggestions(uuid[], uuid[], int, int, boolean),
  public.recipe_with_what_i_have(uuid[], uuid[], int),
  public.recipe_search(uuid[], text, text, text, int, int, uuid[], uuid[], text[], text[], int, text, int) from anon, public;
grant execute on function public.book_people_profiles(uuid), public.recipe_suggestions(uuid[], uuid[], int, int, boolean),
  public.recipe_with_what_i_have(uuid[], uuid[], int),
  public.recipe_search(uuid[], text, text, text, int, int, uuid[], uuid[], text[], text[], int, text, int) to authenticated;

revoke all on public.recipe_profiles, public.recipe_feedback from anon;
grant select, insert, update, delete on public.recipe_profiles to authenticated;
grant select, delete on public.recipe_feedback to authenticated;
grant insert (user_id, recipe_id, kind, created_at) on public.recipe_feedback to authenticated;
grant update (kind, created_at) on public.recipe_feedback to authenticated;
