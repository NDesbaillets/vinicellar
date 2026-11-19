-- ARÔMES V&N · phase 1 « Fondations » : carnets, catalogue d'ingrédients, recettes, notes, photos.
-- Rejouable (idempotent). À exécuter dans Supabase > SQL Editor, après schema.sql et sharing.sql.
-- Ne modifie aucune table ni fonction de la cave. Tout est préfixé recipe_ / book (carnets) et RLS est activée
-- dès la création des tables.
--
-- Modèle : un « carnet » (recipe_books) regroupe des recettes. Chaque utilisateur reçoit le sien à l'inscription,
-- peut y inviter d'autres personnes et appartenir à plusieurs carnets. Rôles :
--   owner  : tout, y compris gérer les membres et les invitations
--   member : créer, modifier, supprimer (corbeille) des recettes
--   reader : consulter et annoter (notes) ; ne modifie ni recette, ni ligne, ni étape, ni photo

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- utilitaires de recherche
-- unaccent() n'est pas IMMUTABLE : ce wrapper permet de l'utiliser dans un index ou un tsvector.
create or replace function public.f_unaccent(t text) returns text
language sql immutable parallel safe strict set search_path = '' as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, t)
$$;
revoke execute on function public.f_unaccent(text) from anon, public;
grant execute on function public.f_unaccent(text) to authenticated;

-- ---------------------------------------------------------------- carnets, membres, invitations
create table if not exists public.recipe_books (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mon carnet' check (length(name) between 1 and 80),
  owner_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists recipe_books_owner_idx on public.recipe_books (owner_id);

create table if not exists public.recipe_book_members (
  book_id uuid not null references public.recipe_books on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('owner','member','reader')),
  created_at timestamptz not null default now(),
  primary key (book_id, user_id)
);
create index if not exists recipe_book_members_user_idx on public.recipe_book_members (user_id);

create table if not exists public.recipe_book_invites (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.recipe_books on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role text not null default 'member' check (role in ('member','reader')),
  invited_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (book_id, email)
);
create index if not exists recipe_book_invites_email_idx on public.recipe_book_invites (email);
create index if not exists recipe_book_invites_invited_by_idx on public.recipe_book_invites (invited_by);

-- Fonctions de droits (security definer : elles lisent les membres sans repasser par la RLS).
create or replace function public.is_book_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from recipe_book_members where book_id = b and user_id = auth.uid())
$$;

create or replace function public.is_book_editor(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from recipe_book_members where book_id = b and user_id = auth.uid() and role in ('owner','member'))
$$;

create or replace function public.is_book_owner(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from recipe_book_members where book_id = b and user_id = auth.uid() and role = 'owner')
$$;

-- Tous les carnets de l'utilisateur connecté.
create or replace function public.my_books() returns setof uuid
language sql stable security definer set search_path = public as $$
  select book_id from recipe_book_members where user_id = auth.uid()
$$;

-- Carnet par défaut : le premier dont l'utilisateur est propriétaire (sert de défaut à recipes.book_id).
create or replace function public.my_book() returns uuid
language sql stable security definer set search_path = public as $$
  select book_id from recipe_book_members where user_id = auth.uid() and role = 'owner'
  order by created_at limit 1
$$;

-- Chaque nouvel utilisateur reçoit son carnet. Trigger distinct de celui des collections (non modifié).
create or replace function public.handle_new_user_recipe_book() returns trigger
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  insert into public.recipe_books (owner_id) values (new.id) returning id into b;
  insert into public.recipe_book_members (book_id, user_id, role) values (b, new.id, 'owner');
  return new;
end $$;
revoke execute on function public.handle_new_user_recipe_book() from anon, authenticated, public;

drop trigger if exists on_auth_user_created_recipe_book on auth.users;
create trigger on_auth_user_created_recipe_book after insert on auth.users
  for each row execute function public.handle_new_user_recipe_book();

-- Utilisateurs déjà inscrits : un carnet chacun (une seule fois).
do $$
declare u record; b uuid;
begin
  for u in select au.id, p.first_name from auth.users au left join public.profiles p on p.id = au.id
           where not exists (select 1 from public.recipe_book_members m where m.user_id = au.id and m.role = 'owner') loop
    insert into public.recipe_books (name, owner_id)
    values (coalesce('Carnet de ' || nullif(u.first_name, ''), 'Mon carnet'), u.id) returning id into b;
    insert into public.recipe_book_members (book_id, user_id, role) values (b, u.id, 'owner');
  end loop;
end $$;

-- Membres d'un carnet, avec nom et e-mail (les profils restent privés sinon).
create or replace function public.book_people(b uuid)
returns table (user_id uuid, full_name text, email text, role text)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.full_name, u.email::text, m.role
  from recipe_book_members m join auth.users u on u.id = m.user_id left join profiles p on p.id = m.user_id
  where m.book_id = b and public.is_book_member(b)
  order by (m.role = 'owner') desc, m.created_at
$$;

-- Invitations en attente pour l'utilisateur connecté.
create or replace function public.my_book_invites()
returns table (id uuid, book_id uuid, book_name text, invited_by_name text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.book_id, b.name, p.full_name, i.role, i.created_at
  from recipe_book_invites i join recipe_books b on b.id = i.book_id left join profiles p on p.id = i.invited_by
  where i.accepted_at is null and i.email = lower(coalesce(auth.jwt()->>'email', ''))
    and not public.is_book_member(i.book_id)
$$;

create or replace function public.accept_book_invite(p_invite uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid; r text;
begin
  update recipe_book_invites set accepted_at = now()
   where id = p_invite and accepted_at is null and email = lower(coalesce(auth.jwt()->>'email', ''))
  returning book_id, role into b, r;
  if b is null then raise exception 'invitation introuvable'; end if;
  insert into recipe_book_members (book_id, user_id, role) values (b, auth.uid(), coalesce(r, 'member'))
  on conflict do nothing;
  return b;
end $$;

create or replace function public.decline_book_invite(p_invite uuid) returns void
language sql security definer set search_path = public as $$
  delete from recipe_book_invites where id = p_invite and email = lower(coalesce(auth.jwt()->>'email', ''))
$$;

alter table public.recipe_books        enable row level security;
alter table public.recipe_book_members enable row level security;
alter table public.recipe_book_invites enable row level security;

-- Pas de policy d'insertion sur recipe_books ni recipe_book_members : les carnets naissent par le trigger
-- d'inscription, les membres arrivent par accept_book_invite().
drop policy if exists "members read" on public.recipe_books;
create policy "members read" on public.recipe_books for select to authenticated using (public.is_book_member(id));
drop policy if exists "owner update" on public.recipe_books;
create policy "owner update" on public.recipe_books for update to authenticated
  using (public.is_book_owner(id)) with check (public.is_book_owner(id));

drop policy if exists "members read" on public.recipe_book_members;
create policy "members read" on public.recipe_book_members for select to authenticated using (public.is_book_member(book_id));
drop policy if exists "remove member or leave" on public.recipe_book_members;
create policy "remove member or leave" on public.recipe_book_members for delete to authenticated
  using (role <> 'owner' and (public.is_book_owner(book_id) or user_id = (select auth.uid())));
drop policy if exists "owner sets role" on public.recipe_book_members;
create policy "owner sets role" on public.recipe_book_members for update to authenticated
  using (role <> 'owner' and public.is_book_owner(book_id))
  with check (role in ('member','reader') and public.is_book_owner(book_id));

-- Les invitations (adresses e-mail) ne sont visibles que du propriétaire ; l'invité passe par my_book_invites().
drop policy if exists "owner read" on public.recipe_book_invites;
create policy "owner read" on public.recipe_book_invites for select to authenticated using (public.is_book_owner(book_id));
drop policy if exists "owner invite" on public.recipe_book_invites;
create policy "owner invite" on public.recipe_book_invites for insert to authenticated with check (public.is_book_owner(book_id));
drop policy if exists "owner cancel" on public.recipe_book_invites;
create policy "owner cancel" on public.recipe_book_invites for delete to authenticated using (public.is_book_owner(book_id));

-- ---------------------------------------------------------------- catalogue d'ingrédients (commun)
create table if not exists public.recipe_ingredients_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  aliases text[] not null default '{}',
  aisle text not null default 'autre' check (aisle in
    ('fruits_legumes','boucherie','poissonnerie','cremerie','epicerie','epices','boulangerie','surgeles','boissons','autre')),
  season_months smallint[] not null default '{}'
    check (season_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  short_season boolean not null default false,
  density_g_per_ml numeric check (density_g_per_ml is null or density_g_per_ml > 0),
  -- 14 allergènes de l'UE : gluten, crustaces, oeufs, poisson, arachides, soja, lait, fruits_a_coque,
  -- celeri, moutarde, sesame, sulfites, lupin, mollusques
  allergens text[] not null default '{}'
    check (allergens <@ array['gluten','crustaces','oeufs','poisson','arachides','soja','lait','fruits_a_coque',
                              'celeri','moutarde','sesame','sulfites','lupin','mollusques']::text[]),
  validated boolean not null default false,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
-- Nom canonique unique, sans tenir compte de la casse ni des accents.
create unique index if not exists recipe_ingredients_catalog_name_uidx
  on public.recipe_ingredients_catalog (lower(public.f_unaccent(name)));
create index if not exists recipe_ingredients_catalog_name_trgm_idx
  on public.recipe_ingredients_catalog using gin (public.f_unaccent(name) extensions.gin_trgm_ops);
create index if not exists recipe_ingredients_catalog_aliases_idx on public.recipe_ingredients_catalog using gin (aliases);
create index if not exists recipe_ingredients_catalog_aisle_idx on public.recipe_ingredients_catalog (aisle);
create index if not exists recipe_ingredients_catalog_season_idx on public.recipe_ingredients_catalog using gin (season_months);
create index if not exists recipe_ingredients_catalog_validated_idx on public.recipe_ingredients_catalog (validated) where not validated;
create index if not exists recipe_ingredients_catalog_created_by_idx on public.recipe_ingredients_catalog (created_by);

alter table public.recipe_ingredients_catalog enable row level security;
drop policy if exists "authenticated read" on public.recipe_ingredients_catalog;
create policy "authenticated read" on public.recipe_ingredients_catalog for select to authenticated using (true);
-- Tout utilisateur connecté peut proposer un ingrédient inconnu, toujours non validé.
drop policy if exists "authenticated propose" on public.recipe_ingredients_catalog;
create policy "authenticated propose" on public.recipe_ingredients_catalog for insert to authenticated
  with check (validated = false);
-- Pas de policy update ni delete pour l'instant : un catalogue commun modifiable par tous serait ouvert à
-- l'écrasement. La validation (validated = true), la correction des alias et des saisons se font côté
-- serveur (SQL Editor, service_role ou edge function) ; une policy « modérateurs » viendra avec la phase 2.

-- ---------------------------------------------------------------- recettes
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null default public.my_book() references public.recipe_books on delete cascade,
  title text not null check (length(title) between 1 and 200),
  title_original text,
  lang_original text,
  summary text,
  course text check (course in ('entree','plat','dessert','accompagnement','boisson','autre')),
  cuisine text,
  servings int check (servings > 0),
  servings_estimated boolean not null default false,
  time_active_min int check (time_active_min >= 0),
  time_active_estimated boolean not null default false,
  time_total_min int check (time_total_min >= 0),
  time_total_estimated boolean not null default false,
  difficulty smallint check (difficulty between 1 and 3),
  family boolean not null default false,                      -- « De famille »
  review_state text not null default 'valide' check (review_state in ('a_verifier','valide')),
  source_type text not null default 'manuel' check (source_type in ('manuel','instagram','web','photo_page')),
  source_url text,
  source_author text,
  alerts jsonb not null default '[]' check (jsonb_typeof(alerts) = 'array'),
  version_group uuid,                                          -- recettes jugées versions l'une de l'autre
  archived_at timestamptz,                                     -- version absorbée par une fusion
  deleted_at timestamptz,                                      -- corbeille (30 jours)
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector                                              -- maintenu par trigger
);
create index if not exists recipes_book_idx on public.recipes (book_id, created_at desc) where deleted_at is null and archived_at is null;
create index if not exists recipes_book_course_idx on public.recipes (book_id, course);
create index if not exists recipes_book_cuisine_idx on public.recipes (book_id, cuisine);
create index if not exists recipes_book_review_idx on public.recipes (book_id, review_state);
create index if not exists recipes_book_source_idx on public.recipes (book_id, source_type);
create index if not exists recipes_family_idx on public.recipes (book_id) where family;
create index if not exists recipes_time_total_idx on public.recipes (time_total_min);
create index if not exists recipes_difficulty_idx on public.recipes (difficulty);
create index if not exists recipes_version_group_idx on public.recipes (version_group) where version_group is not null;
create index if not exists recipes_deleted_idx on public.recipes (deleted_at) where deleted_at is not null;
create index if not exists recipes_archived_idx on public.recipes (archived_at) where archived_at is not null;
create index if not exists recipes_created_by_idx on public.recipes (created_by);
create index if not exists recipes_search_idx on public.recipes using gin (search);
create index if not exists recipes_title_trgm_idx on public.recipes using gin (public.f_unaccent(title) extensions.gin_trgm_ops);

-- Carnet d'une recette (évite la récursion de RLS dans les policies des tables filles).
create or replace function public.recipe_book_id(r uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select book_id from recipes where id = r
$$;

create table if not exists public.recipe_ingredient_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes on delete cascade,
  position int not null default 0,
  group_label text,                                            -- ex. « Pour la pâte »
  catalog_id uuid references public.recipe_ingredients_catalog on delete set null,
  label_original text not null check (length(label_original) between 1 and 300),
  quantity numeric check (quantity >= 0),
  unit text check (unit in ('g','kg','ml','cl','l','cas','cac','piece','pincee','botte','gousse','tranche')),
  precision text,
  optional boolean not null default false
);
create index if not exists recipe_ingredient_lines_recipe_idx on public.recipe_ingredient_lines (recipe_id, position);
create index if not exists recipe_ingredient_lines_catalog_idx on public.recipe_ingredient_lines (catalog_id) where catalog_id is not null;

create table if not exists public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes on delete cascade,
  position int not null default 0,
  text text not null,
  text_original text,
  timer_seconds int check (timer_seconds > 0)
);
create index if not exists recipe_steps_recipe_idx on public.recipe_steps (recipe_id, position);

create table if not exists public.recipe_notes (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes on delete cascade,
  author_id uuid not null default auth.uid() references auth.users on delete cascade,
  body text not null check (length(body) between 1 and 5000),
  private boolean not null default false,                      -- visible de son seul auteur
  created_at timestamptz not null default now()
);
create index if not exists recipe_notes_recipe_idx on public.recipe_notes (recipe_id, created_at);
create index if not exists recipe_notes_author_idx on public.recipe_notes (author_id);

create table if not exists public.recipe_photos (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes on delete cascade,
  storage_path text not null,                                  -- <book_id>/<recipe_id>/<fichier> dans le bucket « recipes »
  kind text not null default 'perso' check (kind in ('origine','perso','studio','illustration','page')),
  is_cover boolean not null default false,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists recipe_photos_recipe_idx on public.recipe_photos (recipe_id);
create index if not exists recipe_photos_created_by_idx on public.recipe_photos (created_by);
create unique index if not exists recipe_photos_path_uidx on public.recipe_photos (storage_path);
-- Au plus une couverture par recette.
create unique index if not exists recipe_photos_one_cover_uidx on public.recipe_photos (recipe_id) where is_cover;

-- ---------------------------------------------------------------- triggers : updated_at, recherche, carnet figé
-- Avant écriture d'une recette : carnet non modifiable (transmettre = copier), recherche plein texte recalculée
-- (titre, résumé, cuisine, ingrédients), updated_at mis à jour (sauf si seule la colonne search change).
create or replace function public.recipes_before_write() returns trigger
language plpgsql set search_path = public as $$
declare ing text;
begin
  if tg_op = 'UPDATE' and new.book_id <> old.book_id then
    raise exception 'le carnet d''une recette ne peut pas changer';
  end if;
  select string_agg(coalesce(c.name, '') || ' ' || l.label_original, ' ' order by l.position) into ing
    from recipe_ingredient_lines l left join recipe_ingredients_catalog c on c.id = l.catalog_id
   where l.recipe_id = new.id;
  new.search :=
    setweight(to_tsvector('french', public.f_unaccent(coalesce(new.title, '') || ' ' || coalesce(new.title_original, ''))), 'A')
    || setweight(to_tsvector('french', public.f_unaccent(coalesce(ing, ''))), 'B')
    || setweight(to_tsvector('french', public.f_unaccent(coalesce(new.summary, '') || ' ' || coalesce(new.cuisine, ''))), 'C');
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'search' - 'updated_at') = (to_jsonb(old) - 'search' - 'updated_at') then
      new.updated_at := old.updated_at;
    else
      new.updated_at := now();
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.recipes_before_write() from anon, authenticated, public;

drop trigger if exists recipes_before_write on public.recipes;
create trigger recipes_before_write before insert or update on public.recipes
  for each row execute function public.recipes_before_write();

-- Une ligne d'ingrédient modifiée relance le calcul de recherche de sa recette (no-op pour updated_at).
create or replace function public.recipe_lines_refresh_search() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update recipes set title = title where id = old.recipe_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.recipe_id <> old.recipe_id) then
    update recipes set title = title where id = new.recipe_id;
  end if;
  return null;
end $$;
revoke execute on function public.recipe_lines_refresh_search() from anon, authenticated, public;

drop trigger if exists recipe_lines_refresh_search on public.recipe_ingredient_lines;
create trigger recipe_lines_refresh_search after insert or update or delete on public.recipe_ingredient_lines
  for each row execute function public.recipe_lines_refresh_search();

-- ---------------------------------------------------------------- RLS : recettes et tables filles
alter table public.recipes                enable row level security;
alter table public.recipe_ingredient_lines enable row level security;
alter table public.recipe_steps           enable row level security;
alter table public.recipe_notes           enable row level security;
alter table public.recipe_photos          enable row level security;

-- Recettes : lecture par tous les membres (corbeille et versions archivées comprises, filtrées côté client),
-- écriture par owner et member. La suppression définitive n'est permise que depuis la corbeille.
drop policy if exists "members read" on public.recipes;
create policy "members read" on public.recipes for select to authenticated using (public.is_book_member(book_id));
drop policy if exists "editors insert" on public.recipes;
create policy "editors insert" on public.recipes for insert to authenticated
  with check (public.is_book_editor(book_id) and created_by = (select auth.uid()));
drop policy if exists "editors update" on public.recipes;
create policy "editors update" on public.recipes for update to authenticated
  using (public.is_book_editor(book_id)) with check (public.is_book_editor(book_id));
drop policy if exists "editors delete trashed" on public.recipes;
create policy "editors delete trashed" on public.recipes for delete to authenticated
  using (public.is_book_editor(book_id) and deleted_at is not null);

-- Lignes, étapes, photos : lecture membres, écriture éditeurs (via le carnet de la recette).
do $$
declare t text;
begin
  foreach t in array array['recipe_ingredient_lines','recipe_steps','recipe_photos'] loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('drop policy if exists "editors insert" on public.%I', t);
    execute format('drop policy if exists "editors update" on public.%I', t);
    execute format('drop policy if exists "editors delete" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated
                    using (public.is_book_member(public.recipe_book_id(recipe_id)))', t);
    execute format('create policy "editors insert" on public.%I for insert to authenticated
                    with check (public.is_book_editor(public.recipe_book_id(recipe_id)))', t);
    execute format('create policy "editors update" on public.%I for update to authenticated
                    using (public.is_book_editor(public.recipe_book_id(recipe_id)))
                    with check (public.is_book_editor(public.recipe_book_id(recipe_id)))', t);
    execute format('create policy "editors delete" on public.%I for delete to authenticated
                    using (public.is_book_editor(public.recipe_book_id(recipe_id)))', t);
  end loop;
end $$;

-- Notes : partagées avec le carnet, sauf notes privées (auteur seul). Tout membre, lecteur compris, écrit,
-- modifie et supprime ses propres notes uniquement (et tant qu'il est encore membre du carnet).
drop policy if exists "members read" on public.recipe_notes;
create policy "members read" on public.recipe_notes for select to authenticated
  using (public.is_book_member(public.recipe_book_id(recipe_id)) and (not private or author_id = (select auth.uid())));
drop policy if exists "members write own" on public.recipe_notes;
create policy "members write own" on public.recipe_notes for insert to authenticated
  with check (author_id = (select auth.uid()) and public.is_book_member(public.recipe_book_id(recipe_id)));
drop policy if exists "authors update own" on public.recipe_notes;
create policy "authors update own" on public.recipe_notes for update to authenticated
  using (author_id = (select auth.uid()) and public.is_book_member(public.recipe_book_id(recipe_id)))
  with check (author_id = (select auth.uid()) and public.is_book_member(public.recipe_book_id(recipe_id)));
drop policy if exists "authors delete own" on public.recipe_notes;
create policy "authors delete own" on public.recipe_notes for delete to authenticated
  using (author_id = (select auth.uid()) and public.is_book_member(public.recipe_book_id(recipe_id)));

-- ---------------------------------------------------------------- corbeille
-- Supprime définitivement les recettes en corbeille depuis plus de 30 jours (lignes, étapes, notes et
-- photos en cascade). Pas de planification ici : à brancher plus tard (pg_cron ou edge function avec
-- service_role). Les fichiers du bucket « recipes » ne sont pas supprimés par SQL : à nettoyer via l'API Storage.
create or replace function public.purge_recipe_trash() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with d as (delete from recipes where deleted_at is not null and deleted_at < now() - interval '30 days' returning 1)
  select count(*) into n from d;
  return n;
end $$;

-- ---------------------------------------------------------------- droits d'exécution
revoke execute on function public.is_book_member(uuid), public.is_book_editor(uuid), public.is_book_owner(uuid),
  public.my_books(), public.my_book(), public.recipe_book_id(uuid), public.book_people(uuid),
  public.my_book_invites(), public.accept_book_invite(uuid), public.decline_book_invite(uuid) from anon, public;
grant execute on function public.is_book_member(uuid), public.is_book_editor(uuid), public.is_book_owner(uuid),
  public.my_books(), public.my_book(), public.recipe_book_id(uuid), public.book_people(uuid),
  public.my_book_invites(), public.accept_book_invite(uuid), public.decline_book_invite(uuid) to authenticated;
-- Droits sur les tables : explicites et minimaux (les projets Supabase récents n'en donnent plus par défaut).
-- Aucun accès anonyme ; la RLS reste le garde-fou ligne par ligne.
revoke all on public.recipe_books, public.recipe_book_members, public.recipe_book_invites,
  public.recipe_ingredients_catalog, public.recipes, public.recipe_ingredient_lines, public.recipe_steps,
  public.recipe_notes, public.recipe_photos from anon;
grant select, update on public.recipe_books to authenticated;
grant select, update, delete on public.recipe_book_members to authenticated;
grant select, insert, delete on public.recipe_book_invites to authenticated;
grant select, insert on public.recipe_ingredients_catalog to authenticated;
grant select, insert, update, delete on public.recipes, public.recipe_ingredient_lines, public.recipe_steps,
  public.recipe_notes, public.recipe_photos to authenticated;
-- La purge n'est appelée que côté serveur.
revoke execute on function public.purge_recipe_trash() from anon, authenticated, public;

-- ---------------------------------------------------------------- stockage des photos (privé)
-- Chemin : <book_id>/<recipe_id>/<fichier>. Lecture : membres du carnet ; écriture : owner et member.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipes', 'recipes', false, 8388608, array['image/jpeg','image/png','image/webp','image/avif','image/gif'])
on conflict (id) do nothing;

drop policy if exists "recipes read" on storage.objects;
create policy "recipes read" on storage.objects for select to authenticated using (
  bucket_id = 'recipes' and exists (
    select 1 from public.recipe_book_members m
     where m.book_id::text = (storage.foldername(name))[1] and m.user_id = (select auth.uid())));

drop policy if exists "recipes editors insert" on storage.objects;
create policy "recipes editors insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'recipes' and array_length(storage.foldername(name), 1) >= 2 and exists (
    select 1 from public.recipe_book_members m
     where m.book_id::text = (storage.foldername(name))[1] and m.user_id = (select auth.uid())
       and m.role in ('owner','member')));

drop policy if exists "recipes editors update" on storage.objects;
create policy "recipes editors update" on storage.objects for update to authenticated using (
  bucket_id = 'recipes' and exists (
    select 1 from public.recipe_book_members m
     where m.book_id::text = (storage.foldername(name))[1] and m.user_id = (select auth.uid())
       and m.role in ('owner','member')));

drop policy if exists "recipes editors delete" on storage.objects;
create policy "recipes editors delete" on storage.objects for delete to authenticated using (
  bucket_id = 'recipes' and exists (
    select 1 from public.recipe_book_members m
     where m.book_id::text = (storage.foldername(name))[1] and m.user_id = (select auth.uid())
       and m.role in ('owner','member')));
