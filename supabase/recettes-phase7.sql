-- ARÔMES V&N · phase 7 « Invités et réceptions » : invités propres au carnet, réceptions et menus, journal « Cuisiné
-- pour », suggestions tenant compte des invités, réception depuis le planning.
-- Rejouable (idempotent). À exécuter APRÈS recettes.sql et recettes-phase2 à 6 (phase 3 pour recipe_cooks, phase 4 pour
-- recipe_suggestions et recipe_profiles, phase 5 pour recipe_meal_plan).
-- Contrat front : docs/recettes/07-invites-contrat.md. Cadrage : docs/recettes/01-cadrage.md §9.
--
-- Ne modifie aucune table ni fonction de la cave. Objets recipe_* existants touchés : recipe_cooks et recipe_meal_plan
-- (une colonne nullable chacune, sans changement de policy ni de droit) et recipe_suggestions (remplacée : nouvelle
-- signature, voir plus bas). La RLS est activée dès la création de chaque table. Aucun droit pour anon.
-- ATTENTION : ne pas rejouer recettes-phase4.sql après ce fichier, il recréerait l'ancienne signature de
-- recipe_suggestions à côté de la nouvelle (appels par paramètres nommés ambigus). Si cela arrive, rejouer ce fichier.
--
-- Confidentialité : allergies, régimes et remarques sur des tiers sont des données de santé. Ces tables ne sont lues
-- que par les membres du carnet (RLS) ; recipe-public, le livre PDF et l'export JSON ne doivent jamais les joindre.

-- ---------------------------------------------------------------- invités : recipe_guests
create table if not exists public.recipe_guests (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.recipe_books on delete cascade,
  name text not null check (length(name) between 1 and 80),
  household text check (length(household) between 1 and 80),                       -- foyer, ex. « Les Dupont »
  -- 14 allergènes de l'UE, mêmes codes et mêmes contrôles que recipe_ingredients_catalog.allergens
  allergens text[] not null default '{}'
    check (allergens <@ array['gluten','crustaces','oeufs','poisson','arachides','soja','lait','fruits_a_coque',
                              'celeri','moutarde','sesame','sulfites','lupin','mollusques']::text[]),
  regime text check (regime in ('omnivore','flexitarien','vegetarien','vegan','pescetarien','sans_gluten','sans_lactose')),
  aversions uuid[] not null default '{}' check (cardinality(aversions) <= 200),        -- ids du catalogue d'ingrédients
  aversions_texte text[] not null default '{}' check (cardinality(aversions_texte) <= 50),
  likes text check (length(likes) <= 2000),                                           -- préférences libres
  notes text check (length(notes) <= 4000),
  linked_user_id uuid references auth.users on delete set null,                       -- compte existant (membre du carnet)
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recipe_guests_book_idx on public.recipe_guests (book_id, name) where archived_at is null;
create index if not exists recipe_guests_book_all_idx on public.recipe_guests (book_id);
create index if not exists recipe_guests_name_trgm_idx
  on public.recipe_guests using gin (public.f_unaccent(name) extensions.gin_trgm_ops);
create index if not exists recipe_guests_linked_idx on public.recipe_guests (linked_user_id) where linked_user_id is not null;
create index if not exists recipe_guests_created_by_idx on public.recipe_guests (created_by);

-- Avant écriture : carnet figé ; le compte lié doit être membre du carnet (sinon ses contraintes de profil ne
-- seraient pas lisibles et le lien serait trompeur) ; updated_at tenu à jour.
create or replace function public.recipe_guests_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.book_id <> old.book_id then
    raise exception 'le carnet d''un invité ne peut pas changer';
  end if;
  if new.linked_user_id is not null
     and (tg_op = 'INSERT' or new.linked_user_id is distinct from old.linked_user_id)
     and not exists (select 1 from recipe_book_members where book_id = new.book_id and user_id = new.linked_user_id) then
    raise exception 'le compte lié doit être membre du carnet';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.recipe_guests_before_write() from anon, authenticated, public;

drop trigger if exists recipe_guests_before_write on public.recipe_guests;
create trigger recipe_guests_before_write before insert or update on public.recipe_guests
  for each row execute function public.recipe_guests_before_write();

alter table public.recipe_guests enable row level security;

drop policy if exists "members read" on public.recipe_guests;
create policy "members read" on public.recipe_guests for select to authenticated using (public.is_book_member(book_id));
drop policy if exists "editors insert" on public.recipe_guests;
create policy "editors insert" on public.recipe_guests for insert to authenticated
  with check (public.is_book_editor(book_id) and created_by = (select auth.uid()));
drop policy if exists "editors update" on public.recipe_guests;
create policy "editors update" on public.recipe_guests for update to authenticated
  using (public.is_book_editor(book_id)) with check (public.is_book_editor(book_id));
drop policy if exists "editors delete" on public.recipe_guests;
create policy "editors delete" on public.recipe_guests for delete to authenticated using (public.is_book_editor(book_id));

revoke all on public.recipe_guests from anon, authenticated;
grant select, delete on public.recipe_guests to authenticated;
grant insert (id, book_id, name, household, allergens, regime, aversions, aversions_texte, likes, notes,
              linked_user_id, archived_at, created_by) on public.recipe_guests to authenticated;
grant update (name, household, allergens, regime, aversions, aversions_texte, likes, notes,
              linked_user_id, archived_at) on public.recipe_guests to authenticated;

-- ---------------------------------------------------------------- réceptions : recipe_receptions
create table if not exists public.recipe_receptions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.recipe_books on delete cascade,
  day date not null,
  slot text check (slot in ('midi','soir')),
  title text check (length(title) between 1 and 120),                                 -- « Anniversaire de Marie »
  note text check (length(note) <= 2000),
  photo_path text check (length(photo_path) <= 300),                                  -- <book_id>/receptions/<fichier> dans le bucket « recipes »
  members_count int check (members_count >= 0),                                       -- membres du carnet présents (hors invités), si connu
  plan_id uuid references public.recipe_meal_plan on delete set null,                 -- case « invités » d'origine
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipe_receptions_photo_path_chk
    check (photo_path is null or (photo_path like book_id::text || '/receptions/%' and photo_path not like '%..%'))
);
create index if not exists recipe_receptions_book_day_idx on public.recipe_receptions (book_id, day desc);
create unique index if not exists recipe_receptions_plan_uidx on public.recipe_receptions (plan_id) where plan_id is not null;
create index if not exists recipe_receptions_created_by_idx on public.recipe_receptions (created_by);

-- Carnet d'une réception (security definer : évite la récursion de RLS dans les policies des tables filles).
create or replace function public.recipe_reception_book_id(r uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select book_id from recipe_receptions where id = r
$$;
revoke execute on function public.recipe_reception_book_id(uuid) from anon, public;
grant execute on function public.recipe_reception_book_id(uuid) to authenticated;

create or replace function public.recipe_receptions_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.book_id <> old.book_id then
    raise exception 'le carnet d''une réception ne peut pas changer';
  end if;
  if new.plan_id is not null and (select book_id from recipe_meal_plan where id = new.plan_id) is distinct from new.book_id then
    raise exception 'la case du planning doit appartenir au carnet de la réception';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.recipe_receptions_before_write() from anon, authenticated, public;

drop trigger if exists recipe_receptions_before_write on public.recipe_receptions;
create trigger recipe_receptions_before_write before insert or update on public.recipe_receptions
  for each row execute function public.recipe_receptions_before_write();

-- Liaison planning <-> réception (la colonne n'est écrite que par recipe_plan_to_reception).
alter table public.recipe_meal_plan
  add column if not exists reception_id uuid references public.recipe_receptions on delete set null;
create index if not exists recipe_meal_plan_reception_idx on public.recipe_meal_plan (reception_id) where reception_id is not null;

alter table public.recipe_receptions enable row level security;

drop policy if exists "members read" on public.recipe_receptions;
create policy "members read" on public.recipe_receptions for select to authenticated using (public.is_book_member(book_id));
drop policy if exists "editors insert" on public.recipe_receptions;
create policy "editors insert" on public.recipe_receptions for insert to authenticated
  with check (public.is_book_editor(book_id) and created_by = (select auth.uid()));
drop policy if exists "editors update" on public.recipe_receptions;
create policy "editors update" on public.recipe_receptions for update to authenticated
  using (public.is_book_editor(book_id)) with check (public.is_book_editor(book_id));
drop policy if exists "editors delete" on public.recipe_receptions;
create policy "editors delete" on public.recipe_receptions for delete to authenticated using (public.is_book_editor(book_id));

revoke all on public.recipe_receptions from anon, authenticated;
grant select, delete on public.recipe_receptions to authenticated;
grant insert (id, book_id, day, slot, title, note, photo_path, members_count, created_by) on public.recipe_receptions to authenticated;
grant update (day, slot, title, note, photo_path, members_count) on public.recipe_receptions to authenticated;

-- ---------------------------------------------------------------- invités d'une réception
create table if not exists public.recipe_reception_guests (
  reception_id uuid not null references public.recipe_receptions on delete cascade,
  guest_id uuid not null references public.recipe_guests on delete cascade,
  primary key (reception_id, guest_id)
);
create index if not exists recipe_reception_guests_guest_idx on public.recipe_reception_guests (guest_id);

-- L'invité doit appartenir au carnet de la réception.
create or replace function public.recipe_reception_guests_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select book_id from recipe_guests where id = new.guest_id) is distinct from
     (select book_id from recipe_receptions where id = new.reception_id) then
    raise exception 'l''invité doit appartenir au carnet de la réception';
  end if;
  return new;
end $$;
revoke execute on function public.recipe_reception_guests_before_write() from anon, authenticated, public;

drop trigger if exists recipe_reception_guests_before_write on public.recipe_reception_guests;
create trigger recipe_reception_guests_before_write before insert or update on public.recipe_reception_guests
  for each row execute function public.recipe_reception_guests_before_write();

-- ---------------------------------------------------------------- plats d'une réception
create table if not exists public.recipe_reception_dishes (
  id uuid primary key default gen_random_uuid(),
  reception_id uuid not null references public.recipe_receptions on delete cascade,
  recipe_id uuid references public.recipes on delete set null,
  -- Intitulé du plat. Pour un plat lié à une recette, rempli par trigger avec le titre de la recette si omis : il
  -- survit ainsi à la suppression définitive de la recette.
  label text not null check (length(label) between 1 and 200),
  course text not null default 'plat' check (course in ('aperitif','entree','plat','fromage','dessert','autre')),
  position int not null default 0
);
create index if not exists recipe_reception_dishes_reception_idx on public.recipe_reception_dishes (reception_id, position);
create index if not exists recipe_reception_dishes_recipe_idx on public.recipe_reception_dishes (recipe_id) where recipe_id is not null;

create or replace function public.recipe_reception_dishes_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recipe_id is not null then
    if (select book_id from recipes where id = new.recipe_id) is distinct from
       (select book_id from recipe_receptions where id = new.reception_id) then
      raise exception 'la recette doit appartenir au carnet de la réception';
    end if;
    if nullif(trim(coalesce(new.label, '')), '') is null then
      select title into new.label from recipes where id = new.recipe_id;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.recipe_reception_dishes_before_write() from anon, authenticated, public;

drop trigger if exists recipe_reception_dishes_before_write on public.recipe_reception_dishes;
create trigger recipe_reception_dishes_before_write before insert or update on public.recipe_reception_dishes
  for each row execute function public.recipe_reception_dishes_before_write();

-- ---------------------------------------------------------------- vins d'une réception (place prévue)
-- item_id pointe vers public.items (fiche Vinicellar) : simple référence, aucune table de la cave n'est modifiée ni
-- lue ici. Aucune logique pour l'instant.
create table if not exists public.recipe_reception_wines (
  id uuid primary key default gen_random_uuid(),
  reception_id uuid not null references public.recipe_receptions on delete cascade,
  item_id uuid references public.items on delete set null,
  label text not null check (length(label) between 1 and 200),
  note text check (length(note) <= 1000)
);
create index if not exists recipe_reception_wines_reception_idx on public.recipe_reception_wines (reception_id);
create index if not exists recipe_reception_wines_item_idx on public.recipe_reception_wines (item_id) where item_id is not null;

-- RLS des trois tables filles : lecture membres, écriture éditeurs (via le carnet de la réception).
alter table public.recipe_reception_guests enable row level security;
alter table public.recipe_reception_dishes enable row level security;
alter table public.recipe_reception_wines  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['recipe_reception_guests','recipe_reception_dishes','recipe_reception_wines'] loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('drop policy if exists "editors insert" on public.%I', t);
    execute format('drop policy if exists "editors update" on public.%I', t);
    execute format('drop policy if exists "editors delete" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated
                    using (public.is_book_member(public.recipe_reception_book_id(reception_id)))', t);
    execute format('create policy "editors insert" on public.%I for insert to authenticated
                    with check (public.is_book_editor(public.recipe_reception_book_id(reception_id)))', t);
    execute format('create policy "editors delete" on public.%I for delete to authenticated
                    using (public.is_book_editor(public.recipe_reception_book_id(reception_id)))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, delete on public.%I to authenticated', t);
  end loop;
  -- Les invités d'une réception ne se modifient pas : on retire et on ajoute (clé composite).
  execute 'grant insert (reception_id, guest_id) on public.recipe_reception_guests to authenticated';
  foreach t in array array['recipe_reception_dishes','recipe_reception_wines'] loop
    execute format('create policy "editors update" on public.%I for update to authenticated
                    using (public.is_book_editor(public.recipe_reception_book_id(reception_id)))
                    with check (public.is_book_editor(public.recipe_reception_book_id(reception_id)))', t);
  end loop;
end $$;

grant insert (id, reception_id, recipe_id, label, course, position) on public.recipe_reception_dishes to authenticated;
grant update (recipe_id, label, course, position) on public.recipe_reception_dishes to authenticated;
grant insert (id, reception_id, item_id, label, note) on public.recipe_reception_wines to authenticated;
grant update (item_id, label, note) on public.recipe_reception_wines to authenticated;

-- ---------------------------------------------------------------- journal : recipe_cooks.reception_id
alter table public.recipe_cooks
  add column if not exists reception_id uuid references public.recipe_receptions on delete set null;
create index if not exists recipe_cooks_reception_idx on public.recipe_cooks (reception_id) where reception_id is not null;
-- Pas de GRANT sur cette colonne : seule recipe_reception_log() l'écrit.

-- Inscrit au journal chaque plat lié à une recette : une cuisson par recette de la réception, à la date de la
-- réception, au nom de l'appelant, portions = invités + membres présents (members_count) si ce dernier est connu,
-- sinon null. Idempotente : une recette déjà journalisée pour cette réception n'est pas recréée (même si la
-- cuisson a été modifiée entre-temps). Recettes supprimées (corbeille) ignorées. Éditeurs seulement.
-- Renvoie le nombre de cuissons créées.
create or replace function public.recipe_reception_log(p_reception uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r recipe_receptions%rowtype; n integer; srv int;
begin
  select * into r from recipe_receptions where id = p_reception;
  if not found or not public.is_book_editor(r.book_id) then
    raise exception 'réception introuvable ou droits insuffisants' using errcode = '42501';
  end if;
  srv := case when r.members_count is null then null
              else nullif((select count(*) from recipe_reception_guests where reception_id = r.id) + r.members_count, 0) end;
  insert into recipe_cooks (recipe_id, cooked_by, cooked_on, servings, reception_id)
  select d.recipe_id, auth.uid(), r.day, srv, r.id
    from (select distinct dd.recipe_id from recipe_reception_dishes dd
           where dd.reception_id = r.id and dd.recipe_id is not null) d
    join recipes rc on rc.id = d.recipe_id and rc.book_id = r.book_id and rc.deleted_at is null
   where not exists (select 1 from recipe_cooks k where k.reception_id = r.id and k.recipe_id = d.recipe_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- vue « Cuisiné pour »
-- Plats servis à chaque invité : plats (liés à une recette) des réceptions dont la date est passée ou du jour
-- (Europe/Zurich), plus les cuissons journalisées pour une réception. Une ligne par recette, invité et réception.
-- security invoker : la RLS des réceptions, invités, plats et cuissons s'applique (un étranger ne voit rien).
create or replace view public.recipe_served_to with (security_invoker = on) as
  select s.recipe_id, s.guest_id, g.name as guest_name, r.day, s.reception_id
    from (
      select d.recipe_id, rg.guest_id, d.reception_id
        from public.recipe_reception_dishes d
        join public.recipe_reception_guests rg on rg.reception_id = d.reception_id
        join public.recipe_receptions rr on rr.id = d.reception_id
       where d.recipe_id is not null and rr.day <= (now() at time zone 'Europe/Zurich')::date
      union
      select k.recipe_id, rg.guest_id, k.reception_id
        from public.recipe_cooks k
        join public.recipe_reception_guests rg on rg.reception_id = k.reception_id
       where k.reception_id is not null
    ) s
    join public.recipe_guests g on g.id = s.guest_id
    join public.recipe_receptions r on r.id = s.reception_id;

revoke all on public.recipe_served_to from anon, authenticated;
grant select on public.recipe_served_to to authenticated;

-- ---------------------------------------------------------------- suggestions (remplace la version de la phase 4)
-- Nouvelle signature : les 5 premiers paramètres, leurs noms, défauts et ordre sont inchangés ; deux paramètres
-- sont ajoutés à la fin.
--   p_guest_ids uuid[] default null : invités visés (de carnets de p_book_ids). Leurs allergies, régime, aversions
--     (catalogue et texte) s'appliquent comme celles des membres visés, ainsi que celles du compte lié (profil
--     lu par book_people_profiles) s'il existe. p_for_users reste inchangé (vide = l'appelant).
--   p_hide_served boolean default false : masque les plats déjà servis à au moins un des invités visés.
-- Sortie : recipe_id, score, raisons, deja_servi text (null ou « Déjà servi à Marie le 12.03.2026, Paul le
--   04.06.2025 », date la plus récente par invité, invités classés du plus récent au plus ancien). Les plats déjà
--   servis passent après tous les autres (ordre interne : score décroissant). Sans p_guest_ids : comportement de la
--   phase 4 à l'identique, deja_servi toujours null.
drop function if exists public.recipe_suggestions(uuid[], uuid[], int, int, boolean);
create or replace function public.recipe_suggestions(
  p_book_ids uuid[],
  p_for_users uuid[] default null,
  p_month int default extract(month from (now() at time zone 'Europe/Zurich'))::int,
  p_limit int default 12,
  p_weekday boolean default (extract(isodow from (now() at time zone 'Europe/Zurich')) <= 5),
  p_guest_ids uuid[] default null,
  p_hide_served boolean default false
)
returns table (recipe_id uuid, score numeric, raisons text[], deja_servi text)
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
  gs as (
    select g.id as gid, g.allergens, g.aversions, g.aversions_texte, g.regime, g.linked_user_id
      from recipe_guests g
     where g.id = any(coalesce(p_guest_ids, '{}')) and g.book_id = any(p_book_ids)
  ),
  lk as (
    select b.allergens, b.aversions, b.aversions_texte, b.regime
      from unnest(p_book_ids) bk cross join lateral public.book_people_profiles(bk) b
     where b.user_id in (select linked_user_id from gs where linked_user_id is not null)
  ),
  cons as (
    select allergens, aversions, aversions_texte, regime from tg
    union all select allergens, aversions, aversions_texte, regime from gs
    union all select allergens, aversions, aversions_texte, regime from lk
  ),
  fa as (
    select
      (select coalesce(array_agg(distinct a), '{}') from (
         select unnest(allergens) a from cons
         union select 'gluten' from cons where regime = 'sans_gluten'
         union select 'lait' from cons where regime in ('sans_lactose', 'vegan')
         union select 'oeufs' from cons where regime = 'vegan'
         union select unnest(array['poisson', 'crustaces', 'mollusques']) from cons where regime in ('vegetarien', 'vegan')) s) as f_allerg,
      (select coalesce(array_agg(distinct a), '{}') from (
         select 'boucherie' a from cons where regime in ('vegetarien', 'vegan', 'pescetarien')
         union select 'poissonnerie' from cons where regime in ('vegetarien', 'vegan')
         union select 'cremerie' from cons where regime = 'vegan') s) as f_aisles,
      (select coalesce(array_agg(distinct a), '{}') from (select unnest(aversions) a from cons) s) as f_avers,
      (select coalesce(array_agg(distinct lower(trim(a))), '{}') from (select unnest(aversions_texte) a from cons) s
        where length(trim(a)) >= 3) as f_avtxt,
      (select min(difficulte_semaine) from tg where user_id = me) as diff_max
  ),
  cand as (
    select r.id, r.difficulty, r.time_total_min
      from recipes r
     where r.book_id = any(p_book_ids)
       and r.deleted_at is null and r.archived_at is null and r.review_state = 'valide'
       and r.course is distinct from 'base'                      -- une base (sauce, pâte…) ne se suggère pas comme repas
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
  sv as (
    select s.recipe_id as rid, s.guest_name, max(s.day) as d
      from recipe_served_to s
     where s.guest_id in (select gid from gs) and s.recipe_id in (select id from cand)
     group by s.recipe_id, s.guest_id, s.guest_name
  ),
  sv2 as (
    select rid, string_agg(guest_name || ' le ' || to_char(d, 'DD.MM.YYYY'), ', ' order by d desc, guest_name) as txt
      from sv group by rid
  ),
  base as (
    select c.id as rid, c.difficulty, c.time_total_min,
           coalesce(s.tagged, 0) as tagged, coalesce(s.ins, 0) as ins, coalesce(s.short_in, false) as short_in, s.in_names,
           k.last_on, k.avg_r,
           case when k.last_on is null then null else greatest(0, today - k.last_on) end as days,
           case when v.txt is null then null else 'Déjà servi à ' || v.txt end as served
      from cand c
      left join seas s on s.rid = c.id
      left join ck k on k.rid = c.id
      left join sv2 v on v.rid = c.id
     where c.id not in (select rid from excluded)
       and not (coalesce(p_hide_served, false) and v.txt is not null)
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
         ], null)::text[],
         s.served::text
    from sc s
    cross join lateral (select case when s.days is null then null
                                    when s.days < 14 then s.days || ' jours'
                                    when s.days < 70 then (s.days / 7) || ' semaines'
                                    else (s.days / 30) || ' mois' end as t) ago
   order by (s.served is not null), 2 desc, s.rid
   limit lim;
end $$;

-- ---------------------------------------------------------------- planning : case « invités » -> réception
-- Crée ou met à jour la réception liée à une case du planning dont l'état est 'invites' (sinon erreur). Éditeurs.
--   Création : jour, créneau et note de la case ; invités = p_guest_ids (null = aucun) ; members_count = convives de
--     la case moins les invités (jamais négatif), null si la case n'a pas de convives ; plats = la recette planifiée
--     (rubrique déduite de la recette), si présente. La case reçoit reception_id.
--   Mise à jour (la case a déjà une réception) : jour et créneau suivent la case ; p_guest_ids null = invités
--     inchangés, tableau (même vide) = nouvelle liste ; la recette planifiée est ajoutée aux plats si elle n'y est pas
--     déjà (aucun plat n'est jamais retiré) ; titre, note et photo de la réception sont conservés.
-- Les invités doivent appartenir au carnet de la case. Renvoie l'id de la réception.
create or replace function public.recipe_plan_to_reception(p_plan uuid, p_guest_ids uuid[])
returns uuid
language plpgsql security definer set search_path = public as $$
declare p recipe_meal_plan%rowtype; rid uuid; ids uuid[]; nb int; rc record;
begin
  select * into p from recipe_meal_plan where id = p_plan;
  if not found or not public.is_book_editor(p.book_id) then
    raise exception 'case introuvable ou droits insuffisants' using errcode = '42501';
  end if;
  if p.state <> 'invites' then raise exception 'la case n''est pas une case invités'; end if;

  if p_guest_ids is not null then
    select coalesce(array_agg(distinct x), '{}') into ids from unnest(p_guest_ids) x where x is not null;
    if exists (select 1 from unnest(ids) g where not exists (select 1 from recipe_guests where id = g and book_id = p.book_id)) then
      raise exception 'invité inconnu dans ce carnet';
    end if;
  end if;

  rid := coalesce(p.reception_id, (select id from recipe_receptions where plan_id = p.id));
  if rid is null then
    nb := coalesce(cardinality(ids), 0);
    insert into recipe_receptions (book_id, day, slot, note, members_count, plan_id, created_by)
    values (p.book_id, p.day, p.slot, p.note,
            case when p.servings is null then null else greatest(p.servings - nb, 0) end, p.id, auth.uid())
    returning id into rid;
  else
    update recipe_receptions set day = p.day, slot = p.slot where id = rid and (day, slot) is distinct from (p.day, p.slot);
  end if;

  if p_guest_ids is not null then
    delete from recipe_reception_guests where reception_id = rid and guest_id <> all(ids);
    insert into recipe_reception_guests (reception_id, guest_id)
    select rid, g from unnest(ids) g on conflict do nothing;
  end if;

  if p.recipe_id is not null
     and not exists (select 1 from recipe_reception_dishes where reception_id = rid and recipe_id = p.recipe_id) then
    select title, course into rc from recipes where id = p.recipe_id;
    insert into recipe_reception_dishes (reception_id, recipe_id, label, course, position)
    values (rid, p.recipe_id, rc.title,
            case when rc.course in ('entree', 'dessert') then rc.course
                 when rc.course is null or rc.course = 'plat' then 'plat' else 'autre' end,
            coalesce((select max(position) + 1 from recipe_reception_dishes where reception_id = rid), 0));
  end if;

  update recipe_meal_plan set reception_id = rid where id = p.id and reception_id is distinct from rid;
  return rid;
end $$;

-- ---------------------------------------------------------------- droits d'exécution
revoke execute on function public.recipe_reception_log(uuid), public.recipe_plan_to_reception(uuid, uuid[]),
  public.recipe_suggestions(uuid[], uuid[], int, int, boolean, uuid[], boolean) from anon, public;
grant execute on function public.recipe_reception_log(uuid), public.recipe_plan_to_reception(uuid, uuid[]),
  public.recipe_suggestions(uuid[], uuid[], int, int, boolean, uuid[], boolean) to authenticated;
