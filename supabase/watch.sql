-- Vinicellar · surveillance des prix (Envies et Vins passés).
-- Tables nouvelles uniquement ; aucune table existante de la cave n'est modifiée.
-- Chaque utilisateur surveille pour lui-même : ses sites, ses vins, ses alertes, ses notifications.
-- Écritures des relevés (offres, prix, alertes, coûts) : fonction « watch » avec la clé de service.

-- Réglages : notifications et seuil de baisse.
create table if not exists public.watch_prefs (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  notify_push boolean not null default false,
  notify_email boolean not null default false,
  drop_pct int not null default 15 check (drop_pct between 5 and 60),
  updated_at timestamptz not null default now()
);

-- Sites surveillés (cavistes, domaines), propres à chaque utilisateur ; la liste par défaut est créée par l'app.
create table if not exists public.watch_sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  domain text not null check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(domain) <= 120),
  country text check (char_length(country) <= 2),
  enabled boolean not null default true,
  builtin boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, domain)
);

-- Vins surveillés : une ligne par vin et par utilisateur, prix cible facultatif (par 75 cl).
create table if not exists public.watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  item_id uuid not null references public.items on delete cascade,
  origin text not null default 'wish' check (origin in ('wish', 'past')),
  target_price numeric(10,2) check (target_price is null or target_price > 0),
  currency text not null default 'CHF' check (currency in ('CHF', 'EUR', 'USD', 'GBP')),
  active boolean not null default true,
  discovered_at timestamptz,
  discover_note text,
  created_at timestamptz not null default now(),
  unique (user_id, item_id)
);

-- Pages produit trouvées chez les sites, avec le dernier prix lu.
create table if not exists public.watch_offers (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references public.watches on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  site_domain text not null,
  url text not null check (url ~ '^https://'),
  title text,
  vintage int,
  volume_cl int check (volume_cl is null or volume_cl between 5 and 3000),
  price numeric(10,2),
  regular_price numeric(10,2),
  currency text,
  in_stock boolean,
  status text not null default 'new' check (status in ('new', 'ok', 'error', 'gone')),
  fails int not null default 0,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (watch_id, url)
);

-- Historique des prix (prix habituel = médiane des 60 derniers jours).
create table if not exists public.watch_prices (
  id bigint generated always as identity primary key,
  offer_id uuid not null references public.watch_offers on delete cascade,
  price numeric(10,2) not null,
  regular_price numeric(10,2),
  in_stock boolean,
  seen_at timestamptz not null default now()
);
create index if not exists watch_prices_offer_seen on public.watch_prices (offer_id, seen_at desc);

-- Alertes : prix cible atteint, baisse, promotion affichée, retour en stock.
create table if not exists public.watch_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  watch_id uuid not null references public.watches on delete cascade,
  offer_id uuid references public.watch_offers on delete set null,
  kind text not null check (kind in ('target', 'drop', 'promo', 'back')),
  price numeric(10,2),
  regular_price numeric(10,2),
  currency text,
  url text,
  site_domain text,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  notified_at timestamptz
);
create index if not exists watch_alerts_user on public.watch_alerts (user_id, created_at desc);

-- Abonnements aux notifications (un par appareil).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now()
);

-- Dépenses d'IA de la surveillance, par utilisateur et par mois (plafond appliqué par la fonction).
create table if not exists public.watch_usage (
  user_id uuid not null references auth.users on delete cascade,
  month date not null,
  cost_chf numeric(8,4) not null default 0,
  calls int not null default 0,
  primary key (user_id, month)
);

alter table public.watch_prefs enable row level security;
alter table public.watch_sites enable row level security;
alter table public.watches enable row level security;
alter table public.watch_offers enable row level security;
alter table public.watch_prices enable row level security;
alter table public.watch_alerts enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.watch_usage enable row level security;

-- Réglages, sites, abonnements : l'utilisateur gère les siens.
create policy "own prefs" on public.watch_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own sites" on public.watch_sites for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own push" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Vins surveillés : seulement des fiches que l'utilisateur peut lire (règles RLS des fiches).
create policy "own watches read" on public.watches for select using (user_id = auth.uid());
create policy "own watches insert" on public.watches for insert
  with check (user_id = auth.uid() and exists (select 1 from public.items i where i.id = item_id));
create policy "own watches update" on public.watches for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own watches delete" on public.watches for delete using (user_id = auth.uid());

-- Offres et alertes : lecture ; l'utilisateur peut retirer une page fausse et marquer une alerte comme vue.
create policy "own offers read" on public.watch_offers for select using (user_id = auth.uid());
create policy "own offers delete" on public.watch_offers for delete using (user_id = auth.uid());
create policy "own prices read" on public.watch_prices for select
  using (exists (select 1 from public.watch_offers o where o.id = offer_id and o.user_id = auth.uid()));
create policy "own alerts read" on public.watch_alerts for select using (user_id = auth.uid());
create policy "own alerts seen" on public.watch_alerts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own usage read" on public.watch_usage for select using (user_id = auth.uid());

-- Marquer une alerte vue : seule la colonne seen_at est modifiable par l'utilisateur.
revoke update on public.watch_alerts from authenticated;
grant update (seen_at) on public.watch_alerts to authenticated;
