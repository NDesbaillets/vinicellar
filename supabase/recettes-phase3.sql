-- ARÔMES V&N · phase 3 « Cuisiner » : journal des cuissons, statut dérivé, photos de cuisson.
-- Rejouable (idempotent). À exécuter dans Supabase > SQL Editor, APRÈS supabase/recettes.sql.
-- Ne modifie aucune table ni fonction de la cave. Seul objet recipe_* existant touché : la contrainte « kind »
-- de recipe_photos (ajout de la valeur 'cuisson') et deux policies supplémentaires (photos, stockage).
--
-- Rôles (cf. docs/recettes/01-cadrage.md §1) : tout membre du carnet, lecteur compris, enregistre SES cuissons.
-- Le lecteur ne modifie ni la recette, ni son statut, ni la couverture.

-- ---------------------------------------------------------------- journal des cuissons
create table if not exists public.recipe_cooks (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes on delete cascade,
  cooked_by uuid not null default auth.uid() references auth.users on delete cascade,
  cooked_on date not null default current_date,
  rating smallint check (rating between 1 and 5),
  comment text check (length(comment) <= 2000),
  servings int check (servings > 0),
  photo_path text check (length(photo_path) <= 300),           -- <book_id>/<recipe_id>/cuissons/<fichier> dans le bucket « recipes »
  created_at timestamptz not null default now()
);
create index if not exists recipe_cooks_recipe_idx on public.recipe_cooks (recipe_id, cooked_on desc);
create index if not exists recipe_cooks_cooked_by_idx on public.recipe_cooks (cooked_by, cooked_on desc);

alter table public.recipe_cooks enable row level security;

-- Lecture : tous les membres du carnet de la recette (le journal est partagé).
drop policy if exists "members read" on public.recipe_cooks;
create policy "members read" on public.recipe_cooks for select to authenticated
  using (public.is_book_member(public.recipe_book_id(recipe_id)));

-- Insertion : tout membre (reader compris), pour lui-même uniquement.
drop policy if exists "members cook" on public.recipe_cooks;
create policy "members cook" on public.recipe_cooks for insert to authenticated
  with check (cooked_by = (select auth.uid()) and public.is_book_member(public.recipe_book_id(recipe_id)));

-- Modification et suppression : l'auteur seul (et tant qu'il est membre du carnet).
drop policy if exists "authors update own" on public.recipe_cooks;
create policy "authors update own" on public.recipe_cooks for update to authenticated
  using (cooked_by = (select auth.uid()) and public.is_book_member(public.recipe_book_id(recipe_id)))
  with check (cooked_by = (select auth.uid()) and public.is_book_member(public.recipe_book_id(recipe_id)));
drop policy if exists "authors delete own" on public.recipe_cooks;
create policy "authors delete own" on public.recipe_cooks for delete to authenticated
  using (cooked_by = (select auth.uid()) and public.is_book_member(public.recipe_book_id(recipe_id)));

-- Droits : explicites et minimaux, aucun pour anon. Mise à jour limitée aux colonnes éditables
-- (ni recipe_id ni cooked_by ne peuvent être réaffectés).
revoke all on public.recipe_cooks from anon;
grant select, delete on public.recipe_cooks to authenticated;
grant insert (id, recipe_id, cooked_by, cooked_on, rating, comment, servings, photo_path) on public.recipe_cooks to authenticated;
grant update (cooked_on, rating, comment, servings, photo_path) on public.recipe_cooks to authenticated;

-- ---------------------------------------------------------------- statut dérivé
-- Une ligne par recette visible de l'appelant (security_invoker : la RLS de recipes et de recipe_cooks
-- s'applique, donc seules les cuissons du carnet sont comptées). « De famille » reste recipes.family.
create or replace view public.recipe_status with (security_invoker = on) as
  select r.id as recipe_id,
         r.book_id,
         count(c.id)::int as cook_count,
         max(c.cooked_on) as last_cooked_on,
         round(avg(c.rating), 1) as avg_rating,
         case when count(c.id) > 0 then 'cuisinee' else 'a_essayer' end as status
    from public.recipes r
    left join public.recipe_cooks c on c.recipe_id = r.id
   group by r.id, r.book_id;

revoke all on public.recipe_status from anon;
grant select on public.recipe_status to authenticated;

-- ---------------------------------------------------------------- photos : kind 'cuisson'
-- La contrainte inline de recettes.sql porte le nom automatique recipe_photos_kind_check.
alter table public.recipe_photos drop constraint if exists recipe_photos_kind_check;
alter table public.recipe_photos add constraint recipe_photos_kind_check
  check (kind in ('origine','perso','studio','illustration','page','cuisson'));
create index if not exists recipe_photos_recipe_kind_idx on public.recipe_photos (recipe_id, kind);

-- Un lecteur peut ajouter une photo de cuisson (jamais une couverture), à son nom, sous le dossier cuissons/ de
-- la recette. Les éditeurs gardent la policy « editors insert » de recettes.sql (qui couvre aussi 'cuisson').
drop policy if exists "members add cooking photo" on public.recipe_photos;
create policy "members add cooking photo" on public.recipe_photos for insert to authenticated
  with check (
    kind = 'cuisson' and not is_cover
    and created_by = (select auth.uid())
    and public.is_book_member(public.recipe_book_id(recipe_id))
    and storage_path like public.recipe_book_id(recipe_id)::text || '/' || recipe_id::text || '/cuissons/%'
    and storage_path not like '%/../%');

-- ---------------------------------------------------------------- stockage : photos de cuisson
-- Chemin imposé : <book_id>/<recipe_id>/cuissons/<fichier>. Tout membre du carnet, lecteur compris, peut
-- téléverser (insertion seule : pas de remplacement, donc un nom de fichier unique par envoi). Lecture : policy
-- « recipes read » existante. Les éditeurs gardent leurs policies de recettes.sql sur tout le bucket.
drop policy if exists "recipes members insert cooking" on storage.objects;
create policy "recipes members insert cooking" on storage.objects for insert to authenticated with check (
  bucket_id = 'recipes'
  and array_length(storage.foldername(name), 1) = 3
  and (storage.foldername(name))[3] = 'cuissons'
  and exists (
    select 1 from public.recipe_book_members m
     where m.book_id::text = (storage.foldername(name))[1] and m.user_id = (select auth.uid()))
  and exists (
    select 1 from public.recipes r
     where r.id::text = (storage.foldername(name))[2] and r.book_id::text = (storage.foldername(name))[1]));
