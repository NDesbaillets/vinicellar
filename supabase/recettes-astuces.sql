-- ARÔMES V&N · « Astuces » : fiches courtes qui ne sont pas des recettes (cuisson, technique, conservation, produit…).
-- Rejouable (idempotent). À exécuter dans Supabase > SQL Editor, APRÈS recettes.sql, les phases 2 à 7,
-- recettes-note.sql et recettes-pdf.sql. Contrat : docs/recettes/08-astuces-contrat.md §1 ; cadrage : 01-cadrage.md §10.
-- Ne modifie aucune table ni fonction de la cave. Côté recettes, seuls sont repris : purge_recipe_trash() (étendue aux
-- astuces), recipe_notify_import() (lien vers l'astuce) et recipe_imports (colonnes target, tip_id, replaces).
-- La RLS est activée dès la création des tables. Les policies Storage du bucket « recipes » (premier dossier = carnet)
-- couvrent déjà <book_id>/tips/… : non modifiées.

-- ---------------------------------------------------------------- astuces
create table if not exists public.recipe_tips (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null default public.my_book() references public.recipe_books on delete cascade,
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),  -- français, sauts de ligne conservés
  title_original text,
  body_original text,
  lang_original text,                                          -- ISO 639-1
  category text not null default 'technique' check (category in
    ('cuisson','technique','conservation','produit','materiel','patisserie','accord','autre')),
  source_type text not null default 'manuel' check (source_type in ('manuel','instagram','web','photo_page','note')),
  source_url text,
  source_author text,                                          -- créateur toujours crédité
  review_state text not null default 'valide' check (review_state in ('a_verifier','valide')),
  alerts text[] not null default '{}',
  import_id uuid references public.recipe_imports on delete set null,   -- import d'origine (« changer de type »)
  deleted_at timestamptz,                                      -- corbeille (30 jours)
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector                                              -- maintenu par trigger
);
create index if not exists recipe_tips_book_idx on public.recipe_tips (book_id, updated_at desc) where deleted_at is null;
create index if not exists recipe_tips_book_category_idx on public.recipe_tips (book_id, category);
create index if not exists recipe_tips_book_review_idx on public.recipe_tips (book_id, review_state);
create index if not exists recipe_tips_created_by_idx on public.recipe_tips (created_by);
create index if not exists recipe_tips_import_idx on public.recipe_tips (import_id) where import_id is not null;
create index if not exists recipe_tips_deleted_idx on public.recipe_tips (deleted_at) where deleted_at is not null;
create index if not exists recipe_tips_search_idx on public.recipe_tips using gin (search);
create index if not exists recipe_tips_title_trgm_idx on public.recipe_tips using gin (public.f_unaccent(title) extensions.gin_trgm_ops);

-- Carnet d'une astuce (évite la récursion de RLS dans les policies des tables filles).
create or replace function public.recipe_tip_book_id(t uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select book_id from recipe_tips where id = t
$$;

create table if not exists public.recipe_tip_ingredients (
  tip_id uuid not null references public.recipe_tips on delete cascade,
  catalog_id uuid not null references public.recipe_ingredients_catalog on delete cascade,
  primary key (tip_id, catalog_id)
);
create index if not exists recipe_tip_ingredients_catalog_idx on public.recipe_tip_ingredients (catalog_id);

create table if not exists public.recipe_tip_recipes (
  tip_id uuid not null references public.recipe_tips on delete cascade,
  recipe_id uuid not null references public.recipes on delete cascade,
  primary key (tip_id, recipe_id)
);
create index if not exists recipe_tip_recipes_recipe_idx on public.recipe_tip_recipes (recipe_id);

create table if not exists public.recipe_tip_photos (
  id uuid primary key default gen_random_uuid(),
  tip_id uuid not null references public.recipe_tips on delete cascade,
  storage_path text not null,                                  -- <book_id>/tips/<tip_id>/<fichier> dans le bucket « recipes »
  kind text not null default 'perso' check (kind in ('origine','perso','page')),
  is_cover boolean not null default false,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  -- Un PDF n'est jamais une couverture.
  constraint recipe_tip_photos_pdf_cover_chk check (not (is_cover and lower(storage_path) like '%.pdf'))
);
create index if not exists recipe_tip_photos_tip_idx on public.recipe_tip_photos (tip_id);
create index if not exists recipe_tip_photos_created_by_idx on public.recipe_tip_photos (created_by);
create unique index if not exists recipe_tip_photos_path_uidx on public.recipe_tip_photos (storage_path);
-- Au plus une couverture par astuce.
create unique index if not exists recipe_tip_photos_one_cover_uidx on public.recipe_tip_photos (tip_id) where is_cover;

-- ---------------------------------------------------------------- triggers : updated_at, recherche, carnet figé
-- Avant écriture d'une astuce : carnet non modifiable, recherche plein texte recalculée (titre A, ingrédients liés B,
-- texte C), updated_at mis à jour (sauf si seule la colonne search change). Même principe que recipes_before_write().
create or replace function public.recipe_tips_before_write() returns trigger
language plpgsql set search_path = public as $$
declare ing text;
begin
  if tg_op = 'UPDATE' and new.book_id <> old.book_id then
    raise exception 'le carnet d''une astuce ne peut pas changer';
  end if;
  select string_agg(c.name, ' ' order by c.name) into ing
    from recipe_tip_ingredients ti join recipe_ingredients_catalog c on c.id = ti.catalog_id
   where ti.tip_id = new.id;
  new.search :=
    setweight(to_tsvector('french', public.f_unaccent(coalesce(new.title, '') || ' ' || coalesce(new.title_original, ''))), 'A')
    || setweight(to_tsvector('french', public.f_unaccent(coalesce(ing, ''))), 'B')
    || setweight(to_tsvector('french', public.f_unaccent(coalesce(new.body, '') || ' ' || coalesce(new.body_original, ''))), 'C');
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'search' - 'updated_at') = (to_jsonb(old) - 'search' - 'updated_at') then
      new.updated_at := old.updated_at;
    else
      new.updated_at := now();
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.recipe_tips_before_write() from anon, authenticated, public;

drop trigger if exists recipe_tips_before_write on public.recipe_tips;
create trigger recipe_tips_before_write before insert or update on public.recipe_tips
  for each row execute function public.recipe_tips_before_write();

-- Un ingrédient lié ajouté, retiré ou remplacé relance le calcul de recherche de son astuce (no-op pour updated_at).
create or replace function public.recipe_tip_ingredients_refresh_search() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update recipe_tips set title = title where id = old.tip_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.tip_id <> old.tip_id) then
    update recipe_tips set title = title where id = new.tip_id;
  end if;
  return null;
end $$;
revoke execute on function public.recipe_tip_ingredients_refresh_search() from anon, authenticated, public;

drop trigger if exists recipe_tip_ingredients_refresh_search on public.recipe_tip_ingredients;
create trigger recipe_tip_ingredients_refresh_search after insert or update or delete on public.recipe_tip_ingredients
  for each row execute function public.recipe_tip_ingredients_refresh_search();

-- Une astuce ne se lie qu'à une recette du même carnet (security definer : lit recipes sans dépendre de la RLS).
create or replace function public.recipe_tip_recipes_same_book() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select book_id from recipe_tips where id = new.tip_id) is distinct from (select book_id from recipes where id = new.recipe_id) then
    raise exception 'la recette liée doit être dans le même carnet que l''astuce';
  end if;
  return new;
end $$;
revoke execute on function public.recipe_tip_recipes_same_book() from anon, authenticated, public;

drop trigger if exists recipe_tip_recipes_same_book on public.recipe_tip_recipes;
create trigger recipe_tip_recipes_same_book before insert or update on public.recipe_tip_recipes
  for each row execute function public.recipe_tip_recipes_same_book();

-- ---------------------------------------------------------------- RLS
alter table public.recipe_tips            enable row level security;
alter table public.recipe_tip_ingredients enable row level security;
alter table public.recipe_tip_recipes     enable row level security;
alter table public.recipe_tip_photos      enable row level security;

-- Astuces : lecture par tous les membres (corbeille comprise, filtrée côté client), écriture par owner et member.
-- La suppression définitive n'est permise que depuis la corbeille.
drop policy if exists "members read" on public.recipe_tips;
create policy "members read" on public.recipe_tips for select to authenticated using (public.is_book_member(book_id));
drop policy if exists "editors insert" on public.recipe_tips;
create policy "editors insert" on public.recipe_tips for insert to authenticated
  with check (public.is_book_editor(book_id) and created_by = (select auth.uid()));
drop policy if exists "editors update" on public.recipe_tips;
create policy "editors update" on public.recipe_tips for update to authenticated
  using (public.is_book_editor(book_id)) with check (public.is_book_editor(book_id));
drop policy if exists "editors delete trashed" on public.recipe_tips;
create policy "editors delete trashed" on public.recipe_tips for delete to authenticated
  using (public.is_book_editor(book_id) and deleted_at is not null);

-- Ingrédients et recettes liés : lecture membres, écriture éditeurs (via le carnet de l'astuce).
do $$
declare t text;
begin
  foreach t in array array['recipe_tip_ingredients','recipe_tip_recipes'] loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('drop policy if exists "editors insert" on public.%I', t);
    execute format('drop policy if exists "editors update" on public.%I', t);
    execute format('drop policy if exists "editors delete" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated
                    using (public.is_book_member(public.recipe_tip_book_id(tip_id)))', t);
    execute format('create policy "editors insert" on public.%I for insert to authenticated
                    with check (public.is_book_editor(public.recipe_tip_book_id(tip_id)))', t);
    execute format('create policy "editors update" on public.%I for update to authenticated
                    using (public.is_book_editor(public.recipe_tip_book_id(tip_id)))
                    with check (public.is_book_editor(public.recipe_tip_book_id(tip_id)))', t);
    execute format('create policy "editors delete" on public.%I for delete to authenticated
                    using (public.is_book_editor(public.recipe_tip_book_id(tip_id)))', t);
  end loop;
end $$;

-- Photos : en plus du droit d'éditeur, le chemin doit être dans le dossier de l'astuce (<book_id>/tips/<tip_id>/…, sans « .. »).
drop policy if exists "members read" on public.recipe_tip_photos;
create policy "members read" on public.recipe_tip_photos for select to authenticated
  using (public.is_book_member(public.recipe_tip_book_id(tip_id)));
drop policy if exists "editors insert" on public.recipe_tip_photos;
create policy "editors insert" on public.recipe_tip_photos for insert to authenticated
  with check (public.is_book_editor(public.recipe_tip_book_id(tip_id))
              and storage_path like public.recipe_tip_book_id(tip_id)::text || '/tips/' || tip_id::text || '/%'
              and storage_path not like '%..%');
drop policy if exists "editors update" on public.recipe_tip_photos;
create policy "editors update" on public.recipe_tip_photos for update to authenticated
  using (public.is_book_editor(public.recipe_tip_book_id(tip_id)))
  with check (public.is_book_editor(public.recipe_tip_book_id(tip_id))
              and storage_path like public.recipe_tip_book_id(tip_id)::text || '/tips/' || tip_id::text || '/%'
              and storage_path not like '%..%');
drop policy if exists "editors delete" on public.recipe_tip_photos;
create policy "editors delete" on public.recipe_tip_photos for delete to authenticated
  using (public.is_book_editor(public.recipe_tip_book_id(tip_id)));

-- ---------------------------------------------------------------- recipe_imports : cible, astuce créée, remplacement
-- target : choix fait avant l'import (le client l'envoie). tip_id et replaces : écrits par l'edge function seulement.
alter table public.recipe_imports add column if not exists target text not null default 'auto';
alter table public.recipe_imports add column if not exists tip_id uuid references public.recipe_tips on delete set null;
alter table public.recipe_imports add column if not exists replaces jsonb;
create index if not exists recipe_imports_tip_idx on public.recipe_imports (tip_id) where tip_id is not null;

alter table public.recipe_imports drop constraint if exists recipe_imports_target_chk;
alter table public.recipe_imports add constraint recipe_imports_target_chk check (target in ('auto','recette','astuce'));
alter table public.recipe_imports drop constraint if exists recipe_imports_replaces_chk;
alter table public.recipe_imports add constraint recipe_imports_replaces_chk check (
  replaces is null or (
    jsonb_typeof(replaces) = 'object' and replaces->>'type' in ('recette','astuce')
    and (replaces->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));

-- Droits d'insertion par colonnes : ceux de recettes-note.sql + target (jamais status, step, error, recipe_id, tip_id, replaces…).
revoke insert on public.recipe_imports from authenticated;
grant insert (id, book_id, created_by, kind, source_url, page_paths, source_text, photo_paths, target) on public.recipe_imports to authenticated;

-- Fin d'import (statut -> termine ou a_relire) : même déclencheur qu'en phase 5 (recipe_notify_import, déjà branché sur
-- recipe_imports), la charge utile porte en plus tip_id ; recipe-notify en tire le lien (astuce.html?id= ou fiche.html?id=).
create or replace function public.recipe_notify_import() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('termine','a_relire') and old.status is distinct from new.status
     and old.status not in ('termine','a_relire') then
    insert into recipe_notifications_outbox (user_id, kind, payload)
    values (new.created_by, 'import_termine',
            jsonb_build_object('book_id', new.book_id, 'import_id', new.id, 'recipe_id', new.recipe_id,
                               'tip_id', new.tip_id, 'status', new.status));
  end if;
  return null;
end $$;
revoke execute on function public.recipe_notify_import() from anon, authenticated, public;

-- ---------------------------------------------------------------- recherche d'astuces
-- Texte libre tolérant aux accents (websearch français sur `search`) et aux fautes (trigrammes sur le titre,
-- word_similarity >= 0,35), comme recipe_search. Sans texte : toutes les astuces, les plus récentes d'abord.
-- security invoker : la RLS limite aux carnets de l'appelant. Astuces en corbeille exclues.
create or replace function public.recipe_tip_search(
  p_book_ids uuid[],
  p_texte text default null,
  p_category text default null,
  p_limit int default 60
)
returns setof public.recipe_tips
language plpgsql stable security invoker set search_path = public as $$
declare
  q text := nullif(trim(public.f_unaccent(lower(coalesce(p_texte, '')))), '');
  tsq tsquery;
  lim int := least(greatest(coalesce(p_limit, 60), 1), 200);
begin
  if auth.uid() is null or p_book_ids is null or cardinality(p_book_ids) = 0 then return; end if;
  if q is not null then tsq := websearch_to_tsquery('french', q); end if;
  return query
  select t.*
    from recipe_tips t
   where t.book_id = any(p_book_ids)
     and t.deleted_at is null
     and (p_category is null or t.category = p_category)
     and (q is null
          or (tsq is not null and t.search @@ tsq)
          or extensions.word_similarity(q, public.f_unaccent(lower(t.title))) >= 0.35)
   order by case when q is null then 0::real
                 else (coalesce(ts_rank(t.search, tsq), 0)
                       + extensions.word_similarity(q, public.f_unaccent(lower(t.title))))::real end desc,
            t.updated_at desc, t.id
   limit lim;
end $$;

-- ---------------------------------------------------------------- astuces liées à une recette
-- Astuces non supprimées du carnet de la recette : liées à elle ('liee') ou partageant au moins un ingrédient du
-- catalogue avec ses lignes ('ingredient:<nom du premier ingrédient commun, dans l'ordre de la recette>'). Liées d'abord,
-- puis par nombre d'ingrédients communs décroissant. 12 au plus. Les ingrédients de base trop génériques sont ignorés
-- (nom canonique sans accents) : sel, poivre, eau, huile d'olive, beurre, sucre, farine. security invoker (RLS).
create or replace function public.recipe_related_tips(p_recipe uuid)
returns table (id uuid, title text, body text, category text, reason text)
language sql stable security invoker set search_path = public as $$
  with r as (
    select rc.book_id from recipes rc where rc.id = p_recipe
  ),
  rc_ing as (
    select l.catalog_id, c.name, min(l.position) as pos
      from recipe_ingredient_lines l join recipe_ingredients_catalog c on c.id = l.catalog_id
     where l.recipe_id = p_recipe
       and lower(public.f_unaccent(c.name)) <> all (array['sel','poivre','eau','huile d''olive','beurre','sucre','farine'])
     group by l.catalog_id, c.name
  ),
  linked as (
    select tr.tip_id from recipe_tip_recipes tr where tr.recipe_id = p_recipe
  ),
  common as (
    select ti.tip_id, count(*) as n, (array_agg(ri.name order by ri.pos, ri.name))[1] as first_name
      from recipe_tip_ingredients ti join rc_ing ri on ri.catalog_id = ti.catalog_id
     group by ti.tip_id
  )
  select t.id, t.title, t.body, t.category,
         case when l.tip_id is not null then 'liee' else 'ingredient:' || cm.first_name end as reason
    from recipe_tips t
    join r on r.book_id = t.book_id
    left join linked l on l.tip_id = t.id
    left join common cm on cm.tip_id = t.id
   where t.deleted_at is null and (l.tip_id is not null or cm.tip_id is not null)
   order by (l.tip_id is not null) desc, coalesce(cm.n, 0) desc, t.updated_at desc, t.id
   limit 12
$$;

-- ---------------------------------------------------------------- corbeille
-- Même fonction qu'en recettes.sql, étendue : supprime aussi les astuces en corbeille depuis plus de 30 jours
-- (ingrédients, recettes liées et photos en cascade). Renvoie le total supprimé (recettes + astuces).
-- Les fichiers du bucket « recipes » ne sont pas supprimés par SQL (comme pour les recettes) : à nettoyer via l'API Storage.
create or replace function public.purge_recipe_trash() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; m integer;
begin
  with d as (delete from recipes where deleted_at is not null and deleted_at < now() - interval '30 days' returning 1)
  select count(*) into n from d;
  with d as (delete from recipe_tips where deleted_at is not null and deleted_at < now() - interval '30 days' returning 1)
  select count(*) into m from d;
  return n + m;
end $$;
revoke execute on function public.purge_recipe_trash() from anon, authenticated, public;

-- ---------------------------------------------------------------- droits
revoke execute on function public.recipe_tip_book_id(uuid), public.recipe_tip_search(uuid[], text, text, int),
  public.recipe_related_tips(uuid) from anon, public;
grant execute on function public.recipe_tip_book_id(uuid), public.recipe_tip_search(uuid[], text, text, int),
  public.recipe_related_tips(uuid) to authenticated;
-- Droits sur les tables : explicites (les projets Supabase récents n'en donnent plus par défaut), aucun accès anonyme ;
-- la RLS reste le garde-fou ligne par ligne.
revoke all on public.recipe_tips, public.recipe_tip_ingredients, public.recipe_tip_recipes, public.recipe_tip_photos from anon;
grant select, insert, update, delete on public.recipe_tips, public.recipe_tip_ingredients, public.recipe_tip_recipes,
  public.recipe_tip_photos to authenticated;
grant all on public.recipe_tips, public.recipe_tip_ingredients, public.recipe_tip_recipes, public.recipe_tip_photos to service_role;
