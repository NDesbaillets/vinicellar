-- ARÔMES V&N · import « Note » : recettes copiées depuis Apple Notes (texte collé + photos).
-- Rejouable (idempotent). À exécuter dans Supabase > SQL Editor, APRÈS recettes.sql et recettes-phase2.sql (et les phases suivantes).
-- Contrat : docs/recettes/02-import-contrat.md §5. Ne touche qu'aux tables recipe_* (recipe_imports, recipes).
--
-- Les contraintes check existantes sont retrouvées par leur définition (leur nom automatique peut varier), supprimées,
-- puis recréées sous un nom fixe : un second passage retrouve et remplace le même nom.

-- ---------------------------------------------------------------- recipe_imports : colonnes
alter table public.recipe_imports add column if not exists source_text text;
alter table public.recipe_imports add column if not exists photo_paths text[] not null default '{}';

-- Retire les anciennes contraintes : kind (liste de valeurs), cohérence de source, bornes des nouvelles colonnes.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.recipe_imports'::regclass and con.contype = 'c'
       and (con.conname in ('recipe_imports_kind_chk', 'recipe_imports_source_chk', 'recipe_imports_source_text_chk', 'recipe_imports_photo_paths_chk')
            or pg_get_constraintdef(con.oid) ~ '^CHECK \(\(?kind = ANY')
  loop
    execute format('alter table public.recipe_imports drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.recipe_imports add constraint recipe_imports_kind_chk
  check (kind in ('instagram','web','photo_page','texte'));
alter table public.recipe_imports add constraint recipe_imports_source_text_chk
  check (source_text is null or length(source_text) between 1 and 20000);
alter table public.recipe_imports add constraint recipe_imports_photo_paths_chk
  check (cardinality(photo_paths) <= 6);                       -- bucket « recipes » : <book_id>/imports/<id>/<n>.jpg
-- Un lien pour instagram/web, 1 à 4 photos pour photo_page, un texte (et 0 à 6 photos) pour texte.
alter table public.recipe_imports add constraint recipe_imports_source_chk check (
  (kind = 'texte' and source_text is not null and length(btrim(source_text)) > 0 and source_url is null
     and cardinality(page_paths) = 0)
  or (kind = 'photo_page' and cardinality(page_paths) between 1 and 4 and source_text is null and cardinality(photo_paths) = 0)
  or (kind in ('instagram','web') and source_url is not null and source_text is null and cardinality(photo_paths) = 0)
);

-- ---------------------------------------------------------------- recipe_imports : insertion
-- Mêmes contrôles qu'en phase 2 ; chaque photo de la note doit en plus se trouver dans le dossier de cet import.
drop policy if exists "editors insert" on public.recipe_imports;
create policy "editors insert" on public.recipe_imports for insert to authenticated
  with check (
    public.is_book_editor(book_id) and created_by = (select auth.uid())
    and not exists (
      select 1 from unnest(page_paths) p
       where p not like book_id::text || '/imports/' || id::text || '/%'
          or p like '%..%')
    and not exists (
      select 1 from unnest(photo_paths) p
       where p is null
          or p not like book_id::text || '/imports/' || id::text || '/%'
          or p like '%..%')
  );

-- Droits d'insertion par colonnes : les colonnes de la phase 2 + source_text et photo_paths (jamais status, step, error…).
revoke insert on public.recipe_imports from authenticated;
grant insert (id, book_id, created_by, kind, source_url, page_paths, source_text, photo_paths) on public.recipe_imports to authenticated;

-- ---------------------------------------------------------------- recipes.source_type accepte « note »
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.recipes'::regclass and con.contype = 'c'
       and (con.conname = 'recipes_source_type_chk' or pg_get_constraintdef(con.oid) ~ '^CHECK \(\(?source_type = ANY')
  loop
    execute format('alter table public.recipes drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.recipes add constraint recipes_source_type_chk
  check (source_type in ('manuel','instagram','web','photo_page','note'));
