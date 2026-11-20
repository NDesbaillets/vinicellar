-- ARÔMES V&N · phase 6 « Transmettre » : liens publics en lecture seule, lien vers l'original d'une recette transmise.
-- Rejouable (idempotent). À exécuter dans Supabase > SQL Editor, APRÈS supabase/recettes.sql et recettes-phase3.sql.
-- Ne modifie aucune table ni fonction de la cave. Seul objet recipe_* existant touché : ajout de la colonne
-- recipes.transmitted_from (nullable, sans effet sur les policies ni les droits existants).
--
-- Lien public : la page partage.html n'a pas de compte. Elle appelle l'edge function recipe-public, qui lit la
-- recette avec le service_role à partir du jeton. La table n'est donc JAMAIS accessible à anon.

-- ---------------------------------------------------------------- recettes transmises
alter table public.recipes
  add column if not exists transmitted_from uuid references public.recipes on delete set null;
create index if not exists recipes_transmitted_from_idx on public.recipes (transmitted_from) where transmitted_from is not null;

-- ---------------------------------------------------------------- liens publics
create table if not exists public.recipe_public_links (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes on delete cascade,
  token text not null unique,                                  -- 32 octets aléatoires, base64url (43 caractères) ; posé par trigger
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
-- Un seul lien actif par recette (en créer un nouveau suppose de révoquer l'ancien).
create unique index if not exists recipe_public_links_active_uidx on public.recipe_public_links (recipe_id) where revoked_at is null;
create index if not exists recipe_public_links_recipe_idx on public.recipe_public_links (recipe_id);
create index if not exists recipe_public_links_created_by_idx on public.recipe_public_links (created_by);

-- Le jeton est toujours généré par la base : toute valeur envoyée par le client est écrasée.
-- gen_random_bytes vient de pgcrypto (schéma extensions sur Supabase) ; repli sur public pour une base de test.
create extension if not exists pgcrypto with schema extensions;
create or replace function public.recipe_public_links_before_insert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  new.token := translate(rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
revoke execute on function public.recipe_public_links_before_insert() from anon, authenticated, public;

drop trigger if exists recipe_public_links_before_insert on public.recipe_public_links;
create trigger recipe_public_links_before_insert before insert on public.recipe_public_links
  for each row execute function public.recipe_public_links_before_insert();

alter table public.recipe_public_links enable row level security;

-- Lecture : membres du carnet de la recette (tout rôle). Jamais anon.
drop policy if exists "members read" on public.recipe_public_links;
create policy "members read" on public.recipe_public_links for select to authenticated
  using (public.is_book_member(public.recipe_book_id(recipe_id)));

-- Création : éditeurs (owner, member), à leur nom.
drop policy if exists "editors create" on public.recipe_public_links;
create policy "editors create" on public.recipe_public_links for insert to authenticated
  with check (public.is_book_editor(public.recipe_book_id(recipe_id)) and created_by = (select auth.uid()));

-- Révocation : éditeurs ; seule la colonne revoked_at est modifiable (voir GRANT) et un lien révoqué le reste.
drop policy if exists "editors revoke" on public.recipe_public_links;
create policy "editors revoke" on public.recipe_public_links for update to authenticated
  using (public.is_book_editor(public.recipe_book_id(recipe_id)) and revoked_at is null)
  with check (public.is_book_editor(public.recipe_book_id(recipe_id)) and revoked_at is not null);

-- Pas de policy delete : l'historique des liens (révoqués) est conservé ; la suppression de la recette l'emporte en cascade.

revoke all on public.recipe_public_links from anon;
revoke all on public.recipe_public_links from authenticated;
grant select on public.recipe_public_links to authenticated;
grant insert (recipe_id) on public.recipe_public_links to authenticated;
grant update (revoked_at) on public.recipe_public_links to authenticated;
