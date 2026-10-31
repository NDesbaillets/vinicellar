-- Vinicellar · listes d'envies (vins à acheter, sans bouteille en cave) et quota du sommelier.
-- À exécuter une fois dans Supabase > SQL Editor, après requests-drafts.sql.

create table if not exists public.wishlists (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null default public.my_collection() references public.collections on delete cascade,
  name text not null check (length(name) between 1 and 80),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists wishlists_collection_idx on public.wishlists (collection_id);

create table if not exists public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists on delete cascade,
  item_id uuid not null references public.items on delete cascade,
  collection_id uuid,
  qty_wanted int check (qty_wanted between 1 and 999),
  target_price numeric(10,2),
  note text,
  added_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (wishlist_id, item_id)
);
create index if not exists wishlist_items_item_idx on public.wishlist_items (item_id);

-- La liste et la fiche doivent appartenir à la même collection.
create or replace function public.check_wishlist_item() returns trigger
language plpgsql set search_path = public as $$
declare lc uuid; ic uuid;
begin
  select collection_id into lc from wishlists where id = new.wishlist_id;
  select collection_id into ic from items where id = new.item_id;
  if lc is null or ic is null or lc <> ic then raise exception 'liste ou fiche invalide'; end if;
  new.collection_id = lc;
  return new;
end $$;
drop trigger if exists wishlist_items_check on public.wishlist_items;
create trigger wishlist_items_check before insert or update on public.wishlist_items
  for each row execute function public.check_wishlist_item();

alter table public.wishlists enable row level security;
alter table public.wishlist_items enable row level security;
drop policy if exists "members" on public.wishlists;
create policy "members" on public.wishlists for all to authenticated
  using (public.is_member(collection_id)) with check (public.is_member(collection_id));
drop policy if exists "members" on public.wishlist_items;
create policy "members" on public.wishlist_items for all to authenticated
  using (public.is_member(collection_id)) with check (public.is_member(collection_id));

-- Une liste « À acheter » par collection existante.
insert into public.wishlists (collection_id, name)
select c.id, 'À acheter' from public.collections c
where not exists (select 1 from public.wishlists w where w.collection_id = c.id);
