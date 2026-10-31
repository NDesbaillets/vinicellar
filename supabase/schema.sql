-- Vinicellar : schéma complet (tables, règles de sécurité, fonctions, stockage).
-- À exécuter une fois dans Supabase > SQL Editor (déjà appliqué sur le projet « vinicellar »).
-- Chaque ligne appartient à un utilisateur ; les règles RLS empêchent tout accès aux données d'autrui.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profils
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  first_name text,
  last_name text,
  full_name text,
  currency text not null default 'CHF' check (currency in ('CHF','EUR','USD','GBP')),
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- lieux (caves)
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) between 1 and 80),
  kind text not null default 'home' check (kind in ('home','secondary','storage','office','other')),
  notes text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists locations_user_idx on public.locations (user_id);

-- ---------------------------------------------------------------- fiches (vins et spiritueux)
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  category text not null default 'wine'
    check (category in ('wine','whisky','sake','rum','brandy','gin','liqueur','other')),
  style text check (style in ('red','white','rose','sparkling','sweet','fortified','orange')),
  name text not null check (length(name) between 1 and 200),
  producer text,
  producer_url text,
  vintage int check (vintage between 1800 and 2100),
  country text,
  region text,
  appellation text,
  grapes text[] not null default '{}',
  abv numeric(4,1),
  volume_cl int default 75,
  -- images : photo de l'utilisateur (étiquette) et image de la bouteille (site du producteur ou revendeur)
  label_path text,
  bottle_path text,
  bottle_image_url text,
  -- textes
  description text,
  vinification text,
  terroir text,
  vintage_notes text,
  pairings text[] not null default '{}',
  -- service et garde
  serving_temp_min int,
  serving_temp_max int,
  drink_from int,
  drink_to int,
  peak_from int,
  peak_to int,
  aging_potential_years int,
  window_source text,
  -- notes et prix
  avg_score numeric(5,1),
  avg_score_scale int check (avg_score_scale in (5,10,20,100)),
  avg_score_source text,
  my_rating numeric(2,1) check (my_rating between 0 and 5),
  market_price numeric(10,2),
  market_currency text default 'CHF',
  price_source text,
  purchase_price numeric(10,2),
  purchase_currency text default 'CHF',
  purchase_year int check (purchase_year between 1900 and 2100),
  purchase_place text,
  -- spiritueux, saké : âge, fût, distillerie, taux de polissage, etc.
  details jsonb not null default '{}',
  sources jsonb not null default '[]',
  notes text,
  ai_enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_user_idx on public.items (user_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- stock par lieu
create table if not exists public.stock (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  item_id uuid not null references public.items on delete cascade,
  location_id uuid not null references public.locations on delete restrict,
  quantity int not null default 0 check (quantity >= 0),
  bin text,
  updated_at timestamptz not null default now(),
  unique (item_id, location_id)
);
create index if not exists stock_user_idx on public.stock (user_id);
create index if not exists stock_location_idx on public.stock (location_id);

-- ---------------------------------------------------------------- dégustations
create table if not exists public.tastings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  item_id uuid not null references public.items on delete cascade,
  location_id uuid references public.locations on delete set null,
  tasted_on date not null default current_date,
  rating numeric(2,1) check (rating between 0 and 5),
  notes text,
  pairing text,
  occasion text,
  consumed boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists tastings_user_idx on public.tastings (user_id, tasted_on desc);
create index if not exists tastings_item_idx on public.tastings (item_id);

-- ---------------------------------------------------------------- quota d'analyses IA
create table if not exists public.ai_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null default 'identify',
  ok boolean,
  created_at timestamptz not null default now()
);
create index if not exists ai_calls_user_idx on public.ai_calls (user_id, created_at desc);

-- ---------------------------------------------------------------- RLS
alter table public.profiles  enable row level security;
alter table public.locations enable row level security;
alter table public.items     enable row level security;
alter table public.stock     enable row level security;
alter table public.tastings  enable row level security;
alter table public.ai_calls  enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['locations','items','stock','tastings'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

drop policy if exists "own ai calls" on public.ai_calls;
create policy "own ai calls" on public.ai_calls for select to authenticated using (user_id = (select auth.uid()));

-- Le stock ne peut pointer que vers une fiche et un lieu du même utilisateur.
create or replace function public.check_stock_owner() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from items where id = new.item_id and user_id = new.user_id)
     or not exists (select 1 from locations where id = new.location_id and user_id = new.user_id) then
    raise exception 'fiche ou lieu invalide';
  end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists stock_owner on public.stock;
create trigger stock_owner before insert or update on public.stock
  for each row execute function public.check_stock_owner();

-- ---------------------------------------------------------------- fonctions appelées par l'app
-- Ajoute ou retire des bouteilles dans un lieu (delta positif ou négatif).
create or replace function public.adjust_stock(p_item uuid, p_location uuid, p_delta int, p_bin text default null)
returns int language plpgsql security invoker set search_path = public as $$
declare q int;
begin
  insert into stock (item_id, location_id, quantity, bin)
  values (p_item, p_location, greatest(p_delta, 0), p_bin)
  on conflict (item_id, location_id)
  do update set quantity = greatest(stock.quantity + p_delta, 0),
                bin = coalesce(excluded.bin, stock.bin)
  returning quantity into q;
  return q;
end $$;

-- Déplace des bouteilles d'un lieu à un autre.
create or replace function public.move_stock(p_item uuid, p_from uuid, p_to uuid, p_qty int)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_qty <= 0 or p_from = p_to then raise exception 'quantité ou lieu invalide'; end if;
  update stock set quantity = quantity - p_qty
   where item_id = p_item and location_id = p_from and quantity >= p_qty;
  if not found then raise exception 'pas assez de bouteilles dans ce lieu'; end if;
  perform adjust_stock(p_item, p_to, p_qty);
end $$;

-- « J'ouvre une bouteille » : retire 1 bouteille du lieu choisi et enregistre la dégustation.
create or replace function public.drink_bottle(
  p_item uuid, p_location uuid, p_tasted_on date default current_date,
  p_rating numeric default null, p_notes text default null,
  p_pairing text default null, p_occasion text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare tid uuid;
begin
  update stock set quantity = quantity - 1
   where item_id = p_item and location_id = p_location and quantity > 0;
  if not found then raise exception 'aucune bouteille dans ce lieu'; end if;
  insert into tastings (item_id, location_id, tasted_on, rating, notes, pairing, occasion, consumed)
  values (p_item, p_location, coalesce(p_tasted_on, current_date), p_rating, p_notes, p_pairing, p_occasion, true)
  returning id into tid;
  return tid;
end $$;

-- Annule une dégustation et remet la bouteille dans son lieu.
create or replace function public.undo_tasting(p_tasting uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare t tastings;
begin
  delete from tastings where id = p_tasting returning * into t;
  if t.id is null then raise exception 'dégustation introuvable'; end if;
  if t.consumed and t.location_id is not null then
    perform adjust_stock(t.item_id, t.location_id, 1);
  end if;
end $$;

revoke execute on function public.adjust_stock(uuid, uuid, int, text) from anon, public;
revoke execute on function public.move_stock(uuid, uuid, uuid, int) from anon, public;
revoke execute on function public.drink_bottle(uuid, uuid, date, numeric, text, text, text) from anon, public;
revoke execute on function public.undo_tasting(uuid) from anon, public;
grant execute on function public.adjust_stock(uuid, uuid, int, text) to authenticated;
grant execute on function public.move_stock(uuid, uuid, uuid, int) to authenticated;
grant execute on function public.drink_bottle(uuid, uuid, date, numeric, text, text, text) to authenticated;
grant execute on function public.undo_tasting(uuid) to authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- ---------------------------------------------------------------- stockage des photos (privé)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('labels', 'labels', false, 8388608, array['image/jpeg','image/png','image/webp','image/avif','image/gif'])
on conflict (id) do nothing;

drop policy if exists "labels own read" on storage.objects;
create policy "labels own read" on storage.objects for select to authenticated
  using (bucket_id = 'labels' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "labels own insert" on storage.objects;
create policy "labels own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'labels' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "labels own update" on storage.objects;
create policy "labels own update" on storage.objects for update to authenticated
  using (bucket_id = 'labels' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "labels own delete" on storage.objects;
create policy "labels own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'labels' and (storage.foldername(name))[1] = (select auth.uid())::text);
