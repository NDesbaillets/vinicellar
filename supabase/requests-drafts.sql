-- Vinicellar · demandes d'invitation validées par l'admin, et file d'analyses (ajouter plusieurs bouteilles en parallèle).
-- À exécuter une fois dans Supabase > SQL Editor, après schema.sql et sharing.sql.

-- ---------------------------------------------------------------- admin
alter table public.profiles add column if not exists is_admin boolean not null default false;
update public.profiles set is_admin = true
 where id in (select id from auth.users where lower(email) = 'nicolas.desbaillets@gmail.com');

-- Un utilisateur ne peut pas se donner lui-même le rôle d'admin.
create or replace function public.protect_admin_flag() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_admin is distinct from old.is_admin and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.is_admin := old.is_admin;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_admin on public.profiles;
create trigger profiles_protect_admin before update on public.profiles
  for each row execute function public.protect_admin_flag();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;
revoke execute on function public.is_admin() from anon, public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------- demandes d'invitation
create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and position('@' in email) > 1),
  name text not null,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users on delete set null
);
create unique index if not exists access_requests_pending_email on public.access_requests (email) where status = 'pending';
alter table public.access_requests enable row level security;
drop policy if exists "admin read" on public.access_requests;
create policy "admin read" on public.access_requests for select to authenticated using (public.is_admin());
-- Écriture uniquement par les fonctions serveur (request-access, admin-review).

-- ---------------------------------------------------------------- contre-étiquette
alter table public.items add column if not exists label_back_path text;

-- ---------------------------------------------------------------- file d'analyses
create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null default public.my_collection() references public.collections on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  location_id uuid references public.locations on delete set null,
  qty int not null default 1 check (qty between 0 and 999),
  bin text,
  hint jsonb not null default '{}',
  photo_paths text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','ready','error')),
  result jsonb,
  bottle_path text,
  sources jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drafts_collection_idx on public.drafts (collection_id, created_at desc);
alter table public.drafts enable row level security;
drop policy if exists "members" on public.drafts;
create policy "members" on public.drafts for all to authenticated
  using (public.is_member(collection_id)) with check (public.is_member(collection_id));
drop trigger if exists drafts_touch on public.drafts;
create trigger drafts_touch before update on public.drafts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- photos : aussi visibles depuis la file d'analyses
drop policy if exists "labels read" on storage.objects;
create policy "labels read" on storage.objects for select to authenticated using (
  bucket_id = 'labels' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.items i where i.label_path = storage.objects.name or i.bottle_path = storage.objects.name or i.label_back_path = storage.objects.name)
    or exists (select 1 from public.drafts d where storage.objects.name = any (d.photo_paths) or d.bottle_path = storage.objects.name)
  ));
drop policy if exists "labels delete" on storage.objects;
create policy "labels delete" on storage.objects for delete to authenticated using (
  bucket_id = 'labels' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.items i where i.label_path = storage.objects.name or i.bottle_path = storage.objects.name or i.label_back_path = storage.objects.name)
  ));
