-- Vinicellar · partage des caves (couple, famille) et sorties de bouteilles (bue, offerte, autre).
-- À exécuter une fois après schema.sql (déjà appliqué sur le projet « vinicellar »).
--
-- Modèle : une « collection » regroupe des caves (lieux), des fiches, du stock et des sorties.
-- Chaque utilisateur possède sa collection ; il peut inviter d'autres personnes, qui la gèrent avec lui.

-- ---------------------------------------------------------------- collections et membres
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Ma cave' check (length(name) between 1 and 80),
  owner_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.collection_members (
  collection_id uuid not null references public.collections on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (collection_id, user_id)
);
create index if not exists collection_members_user_idx on public.collection_members (user_id);

create table if not exists public.collection_invites (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  invited_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (collection_id, email)
);

create or replace function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from collection_members where collection_id = c and user_id = auth.uid())
$$;

create or replace function public.is_owner(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from collection_members where collection_id = c and user_id = auth.uid() and role = 'owner')
$$;

-- Collection par défaut de l'utilisateur : la sienne d'abord, sinon la première partagée.
create or replace function public.my_collection() returns uuid
language sql stable security definer set search_path = public as $$
  select collection_id from collection_members where user_id = auth.uid()
  order by (role = 'owner') desc, created_at limit 1
$$;

-- Chaque nouvel utilisateur reçoit sa collection.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  insert into public.collections (owner_id) values (new.id) returning id into c;
  insert into public.collection_members (collection_id, user_id, role) values (c, new.id, 'owner');
  return new;
end $$;

-- ---------------------------------------------------------------- rattachement des données existantes
alter table public.locations add column if not exists collection_id uuid references public.collections on delete cascade;
alter table public.items     add column if not exists collection_id uuid references public.collections on delete cascade;
alter table public.stock     add column if not exists collection_id uuid references public.collections on delete cascade;
alter table public.tastings  add column if not exists collection_id uuid references public.collections on delete cascade;

do $$
declare u record; c uuid;
begin
  for u in select p.id, p.first_name from public.profiles p
           where not exists (select 1 from public.collection_members m where m.user_id = p.id and m.role = 'owner') loop
    insert into public.collections (name, owner_id)
    values (coalesce('Cave de ' || nullif(u.first_name, ''), 'Ma cave'), u.id) returning id into c;
    insert into public.collection_members (collection_id, user_id, role) values (c, u.id, 'owner');
  end loop;
end $$;

update public.locations l set collection_id = m.collection_id from public.collection_members m
 where l.collection_id is null and m.user_id = l.user_id and m.role = 'owner';
update public.items i set collection_id = m.collection_id from public.collection_members m
 where i.collection_id is null and m.user_id = i.user_id and m.role = 'owner';
update public.stock s set collection_id = l.collection_id from public.locations l
 where s.collection_id is null and l.id = s.location_id;
update public.tastings t set collection_id = i.collection_id from public.items i
 where t.collection_id is null and i.id = t.item_id;

alter table public.locations alter column collection_id set default public.my_collection();
alter table public.items     alter column collection_id set default public.my_collection();
alter table public.locations alter column collection_id set not null;
alter table public.items     alter column collection_id set not null;
alter table public.stock     alter column collection_id set not null;
alter table public.tastings  alter column collection_id set not null;
create index if not exists locations_collection_idx on public.locations (collection_id);
create index if not exists items_collection_idx on public.items (collection_id);
create index if not exists stock_collection_idx on public.stock (collection_id);
create index if not exists tastings_collection_idx on public.tastings (collection_id, tasted_on desc);

-- Le stock et les sorties héritent de la collection (déclencheurs BEFORE, avant les contrôles NOT NULL et RLS) ; une fiche et un lieu doivent appartenir à la même collection.
create or replace function public.check_stock_owner() returns trigger
language plpgsql set search_path = public as $$
declare lc uuid; ic uuid;
begin
  select collection_id into lc from locations where id = new.location_id;
  select collection_id into ic from items where id = new.item_id;
  if lc is null or ic is null or lc <> ic then raise exception 'fiche ou lieu invalide'; end if;
  new.collection_id = lc;
  new.updated_at = now();
  return new;
end $$;

create or replace function public.fill_tasting_collection() returns trigger
language plpgsql set search_path = public as $$
begin
  select collection_id into new.collection_id from items where id = new.item_id;
  if new.collection_id is null then raise exception 'fiche introuvable'; end if;
  return new;
end $$;
drop trigger if exists tastings_collection on public.tastings;
create trigger tastings_collection before insert on public.tastings
  for each row execute function public.fill_tasting_collection();

-- ---------------------------------------------------------------- sorties : bue, offerte, autre
alter table public.tastings add column if not exists reason text not null default 'drunk'
  check (reason in ('drunk','gifted','other'));
alter table public.tastings add column if not exists recipient text;

drop function if exists public.drink_bottle(uuid, uuid, date, numeric, text, text, text);
create or replace function public.take_bottle(
  p_item uuid, p_location uuid, p_reason text default 'drunk', p_recipient text default null,
  p_tasted_on date default current_date, p_rating numeric default null,
  p_notes text default null, p_pairing text default null, p_occasion text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare tid uuid;
begin
  update stock set quantity = quantity - 1
   where item_id = p_item and location_id = p_location and quantity > 0;
  if not found then raise exception 'aucune bouteille dans ce lieu'; end if;
  insert into tastings (item_id, location_id, reason, recipient, tasted_on, rating, notes, pairing, occasion, consumed)
  values (p_item, p_location, coalesce(p_reason, 'drunk'), p_recipient, coalesce(p_tasted_on, current_date),
          p_rating, p_notes, p_pairing, p_occasion, true)
  returning id into tid;
  return tid;
end $$;
revoke execute on function public.take_bottle(uuid, uuid, text, text, date, numeric, text, text, text) from anon, public;
grant execute on function public.take_bottle(uuid, uuid, text, text, date, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------- règles d'accès : les membres partagent tout
do $$
declare t text;
begin
  foreach t in array array['locations','items','stock','tastings'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('drop policy if exists "members" on public.%I', t);
    execute format('create policy "members" on public.%I for all to authenticated
                    using (public.is_member(collection_id)) with check (public.is_member(collection_id))', t);
  end loop;
end $$;

alter table public.collections        enable row level security;
alter table public.collection_members enable row level security;
alter table public.collection_invites enable row level security;

drop policy if exists "members read" on public.collections;
create policy "members read" on public.collections for select to authenticated using (public.is_member(id));
drop policy if exists "owner update" on public.collections;
create policy "owner update" on public.collections for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));

drop policy if exists "members read" on public.collection_members;
create policy "members read" on public.collection_members for select to authenticated using (public.is_member(collection_id));
drop policy if exists "remove member or leave" on public.collection_members;
create policy "remove member or leave" on public.collection_members for delete to authenticated
  using (role <> 'owner' and (public.is_owner(collection_id) or user_id = (select auth.uid())));

drop policy if exists "members read" on public.collection_invites;
create policy "members read" on public.collection_invites for select to authenticated using (public.is_member(collection_id));
drop policy if exists "owner invite" on public.collection_invites;
create policy "owner invite" on public.collection_invites for insert to authenticated with check (public.is_owner(collection_id));
drop policy if exists "owner cancel" on public.collection_invites;
create policy "owner cancel" on public.collection_invites for delete to authenticated using (public.is_owner(collection_id));

-- ---------------------------------------------------------------- fonctions de partage
-- Membres d'une collection, avec nom et e-mail (les profils restent privés sinon).
create or replace function public.collection_people(c uuid)
returns table (user_id uuid, full_name text, email text, role text)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.full_name, u.email::text, m.role
  from collection_members m join auth.users u on u.id = m.user_id left join profiles p on p.id = m.user_id
  where m.collection_id = c and public.is_member(c)
  order by (m.role = 'owner') desc, m.created_at
$$;

-- Invitations en attente pour l'utilisateur connecté.
create or replace function public.my_invites()
returns table (id uuid, collection_id uuid, collection_name text, invited_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.collection_id, c.name, p.full_name, i.created_at
  from collection_invites i join collections c on c.id = i.collection_id left join profiles p on p.id = i.invited_by
  where i.accepted_at is null and i.email = lower(coalesce(auth.jwt()->>'email', ''))
    and not public.is_member(i.collection_id)
$$;

create or replace function public.accept_invite(p_invite uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  update collection_invites set accepted_at = now()
   where id = p_invite and accepted_at is null and email = lower(coalesce(auth.jwt()->>'email', ''))
  returning collection_id into c;
  if c is null then raise exception 'invitation introuvable'; end if;
  insert into collection_members (collection_id, user_id, role) values (c, auth.uid(), 'member')
  on conflict do nothing;
  return c;
end $$;

create or replace function public.decline_invite(p_invite uuid) returns void
language sql security definer set search_path = public as $$
  delete from collection_invites where id = p_invite and email = lower(coalesce(auth.jwt()->>'email', ''))
$$;

revoke execute on function public.is_member(uuid), public.is_owner(uuid), public.my_collection(),
  public.collection_people(uuid), public.my_invites(), public.accept_invite(uuid), public.decline_invite(uuid) from anon, public;
grant execute on function public.is_member(uuid), public.is_owner(uuid), public.my_collection(),
  public.collection_people(uuid), public.my_invites(), public.accept_invite(uuid), public.decline_invite(uuid) to authenticated;

-- ---------------------------------------------------------------- photos : visibles par tous les membres
drop policy if exists "labels own read" on storage.objects;
drop policy if exists "labels read" on storage.objects;
create policy "labels read" on storage.objects for select to authenticated using (
  bucket_id = 'labels' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.items i where i.label_path = storage.objects.name or i.bottle_path = storage.objects.name)
  ));
drop policy if exists "labels own delete" on storage.objects;
drop policy if exists "labels delete" on storage.objects;
create policy "labels delete" on storage.objects for delete to authenticated using (
  bucket_id = 'labels' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.items i where i.label_path = storage.objects.name or i.bottle_path = storage.objects.name)
  ));
