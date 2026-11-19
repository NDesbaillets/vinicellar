-- ARÔMES V&N · phase 2 « Import » : suivi des imports en arrière-plan, vidéos temporaires, détection des doublons.
-- Rejouable (idempotent). À exécuter dans Supabase > SQL Editor, APRÈS recettes.sql.
-- Contrat : docs/recettes/02-import-contrat.md §1. Ne modifie aucune table ni fonction de la cave ni de recettes.sql :
-- tout est préfixé recipe_ ; la RLS est activée dès la création de la table.
--
-- Écriture : le client ne fait qu'ajouter une ligne (statut « en_attente » imposé par les droits de colonnes) ; seule
-- l'edge function recipe-import (service_role) la fait avancer. Aucun droit pour anon.

-- ---------------------------------------------------------------- recipe_imports
create table if not exists public.recipe_imports (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.recipe_books on delete cascade,
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('instagram','web','photo_page')),
  source_url text check (source_url is null or length(source_url) <= 2000),
  page_paths text[] not null default '{}' check (cardinality(page_paths) <= 4),   -- bucket « recipes » : <book_id>/imports/<id>/<n>.jpg
  status text not null default 'en_attente' check (status in ('en_attente','en_cours','a_relire','termine','echec')),
  step text,                                                   -- étape lisible, en français
  error text,                                                  -- message français si « echec »
  recipe_id uuid references public.recipes on delete set null, -- fiche créée
  duplicate_of uuid references public.recipes on delete set null,
  video_path text,                                             -- bucket « recipe-videos », supprimée après 30 jours
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un lien pour instagram/web, 1 à 4 photos pour photo_page.
  constraint recipe_imports_source_chk check (
    (kind = 'photo_page' and cardinality(page_paths) between 1 and 4)
    or (kind <> 'photo_page' and source_url is not null)
  )
);
create index if not exists recipe_imports_book_idx on public.recipe_imports (book_id, created_at desc);
create index if not exists recipe_imports_user_idx on public.recipe_imports (created_by, created_at desc);
create index if not exists recipe_imports_recipe_idx on public.recipe_imports (recipe_id) where recipe_id is not null;
create index if not exists recipe_imports_duplicate_idx on public.recipe_imports (duplicate_of) where duplicate_of is not null;
create index if not exists recipe_imports_active_idx on public.recipe_imports (status, updated_at) where status in ('en_attente','en_cours');
create index if not exists recipe_imports_video_idx on public.recipe_imports (created_at) where video_path is not null;

create or replace function public.recipe_imports_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.recipe_imports_touch() from anon, authenticated, public;

drop trigger if exists recipe_imports_touch on public.recipe_imports;
create trigger recipe_imports_touch before update on public.recipe_imports
  for each row execute function public.recipe_imports_touch();

alter table public.recipe_imports enable row level security;

drop policy if exists "members read" on public.recipe_imports;
create policy "members read" on public.recipe_imports for select to authenticated
  using (public.is_book_member(book_id));

-- Insertion : éditeurs du carnet, à leur nom. Les photos de page doivent se trouver dans le dossier de cet import
-- (l'edge function lit ces chemins avec service_role : aucun autre chemin ne doit passer).
drop policy if exists "editors insert" on public.recipe_imports;
create policy "editors insert" on public.recipe_imports for insert to authenticated
  with check (
    public.is_book_editor(book_id) and created_by = (select auth.uid())
    and not exists (
      select 1 from unnest(page_paths) p
       where p not like book_id::text || '/imports/' || id::text || '/%'
          or p like '%..%')
  );

-- Pas de policy d'update : le client ne modifie jamais un import. Il peut retirer les siens une fois terminés.
drop policy if exists "author delete finished" on public.recipe_imports;
create policy "author delete finished" on public.recipe_imports for delete to authenticated
  using (created_by = (select auth.uid()) and status in ('termine','echec'));

-- Droits : explicites et minimaux. Insertion limitée aux colonnes que le client choisit (le statut, l'étape,
-- les erreurs et les liens vers la fiche restent à la fonction serveur).
revoke all on public.recipe_imports from anon, authenticated;
grant select, delete on public.recipe_imports to authenticated;
grant insert (id, book_id, created_by, kind, source_url, page_paths) on public.recipe_imports to authenticated;
grant all on public.recipe_imports to service_role;

-- Suivi en temps réel (le front écoute recipe_imports). Idempotent : on vérifie la publication avant d'y ajouter.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recipe_imports') then
    alter publication supabase_realtime add table public.recipe_imports;
  end if;
end $$;

-- ---------------------------------------------------------------- vidéos temporaires (privé, service_role seulement)
-- Chemin : <book_id>/<import_id>.mp4. Aucune policy sur storage.objects pour ce bucket : la RLS refuse tout client.
-- Rappel : la limite globale de taille d'un fichier (Storage > Settings) plafonne aussi celle du bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-videos', 'recipe-videos', false, 104857600, array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Imports dont la vidéo a plus de 30 jours. Les fichiers ne se suppriment pas en SQL : l'edge function recipe-import
-- appelle cette fonction au début de chaque import, supprime les fichiers par l'API Storage puis vide video_path.
create or replace function public.purge_recipe_videos()
returns table (id uuid, book_id uuid, video_path text)
language sql stable set search_path = '' as $$
  select i.id, i.book_id, i.video_path
    from public.recipe_imports i
   where i.video_path is not null and i.created_at < now() - interval '30 days'
   order by i.created_at
   limit 100
$$;
revoke execute on function public.purge_recipe_videos() from anon, authenticated, public;
grant execute on function public.purge_recipe_videos() to service_role;

-- ---------------------------------------------------------------- doublons
-- Recettes proches dans les carnets donnés : même lien source, ou titre voisin (similarité trigramme > 0,45, sans
-- accents ni casse). SECURITY INVOKER : appelée avec le JWT d'un client, la RLS limite aux carnets visibles ;
-- appelée par service_role, l'appelant fournit lui-même la liste des carnets de l'utilisateur.
-- Les recettes en corbeille ou absorbées par une fusion sont ignorées.
create or replace function public.recipe_find_duplicates(p_book_ids uuid[], p_title text, p_source_url text)
returns table (id uuid, book_id uuid, title text, source_url text, reason text, score real)
language sql stable set search_path = '' as $$
  with q as (
    select public.f_unaccent(lower(coalesce(p_title, ''))) as t,
           nullif(rtrim(regexp_replace(lower(coalesce(p_source_url, '')), '[?#].*$', ''), '/'), '') as u
  ), c as (
    select r.id, r.book_id, r.title, r.source_url,
           (q.u is not null
            and rtrim(regexp_replace(lower(coalesce(r.source_url, '')), '[?#].*$', ''), '/') = q.u) as same_url,
           extensions.similarity(public.f_unaccent(lower(r.title)), q.t) as sim
      from public.recipes r, q
     where r.book_id = any (p_book_ids) and r.deleted_at is null and r.archived_at is null
  )
  select c.id, c.book_id, c.title, c.source_url,
         case when c.same_url then 'source_url' else 'titre' end,
         (case when c.same_url then 1.0 else c.sim end)::real
    from c
   where c.same_url or c.sim > 0.45
   order by c.same_url desc, c.sim desc
   limit 5
$$;
revoke execute on function public.recipe_find_duplicates(uuid[], text, text) from anon, public;
grant execute on function public.recipe_find_duplicates(uuid[], text, text) to authenticated, service_role;
