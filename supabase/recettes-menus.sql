-- ARÔMES V&N · menus et PDF à plusieurs recettes. Contrat : docs/recettes/09-menus-pdf-contrat.md §1 ; cadrage : 01-cadrage.md §11.
-- Rejouable (idempotent). À exécuter dans Supabase > SQL Editor, APRÈS recettes.sql, les phases 2 à 7, recettes-note.sql,
-- recettes-pdf.sql, recettes-astuces.sql et recettes-base.sql.
--
-- Contrainte d'exploitation : AUCUNE instruction « drop » ni « revoke » au niveau supérieur (le SQL Editor demande alors une
-- confirmation que le propriétaire ne voit que sur ordinateur). Tout remplacement de contrainte, de policy ou de droit passe
-- par un bloc DO qui exécute l'instruction dynamiquement ; le reste utilise « create … if not exists », « create or replace »
-- et des « grant » additifs.
--
-- Ne modifie aucune table ni fonction de la cave. Objets recipe_* existants touchés :
--   recipe_imports       : kind accepte 'pdf_extrait', 5 colonnes, contrainte de source, policy d'insertion, droits d'insertion ;
--   recipe_meal_plan     : colonne menu_id, contrainte « recette ou menu », trigger de cohérence du carnet, droits de colonne ;
--   recipe_shopping_add_plan() et recipe_plan_to_reception() : une case « menu » vaut l'ensemble des recettes du menu
--                          (fonctions relues par pg_get_functiondef et complétées, sans les recopier) ;
--   purge_recipe_trash() : purge aussi les menus en corbeille depuis plus de 30 jours ;
--   bucket « recipes »   : file_size_limit porté à 30 Mo.
-- La RLS est activée dès la création de chaque table.

-- ---------------------------------------------------------------- analyse d'un PDF : recipe_pdf_jobs
-- Une ligne par PDF à analyser. Le client insère (id, book_id, created_by, pdf_path) ; seule l'edge function recipe-import
-- (service_role) fait avancer le statut et écrit le sommaire (toc). toc : tableau d'objets
-- { idx, titre, type_plat, nature ('recette'|'astuce'), pages (1-based), rubrique }.
create table if not exists public.recipe_pdf_jobs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.recipe_books on delete cascade,
  created_by uuid default auth.uid() references auth.users on delete set null,
  pdf_path text not null check (length(pdf_path) <= 300),     -- <book_id>/imports/<job_id>/source.pdf dans le bucket « recipes »
  page_count int check (page_count > 0),
  status text not null default 'en_attente' check (status in ('en_attente','en_cours','pret','echec')),
  error text,
  document text check (document in ('menu','recueil','recette')),
  menu_title text check (length(menu_title) <= 200),
  toc jsonb not null default '[]' check (jsonb_typeof(toc) = 'array' and jsonb_array_length(toc) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipe_pdf_jobs_path_chk
    check (pdf_path like book_id::text || '/imports/' || id::text || '/%' and pdf_path not like '%..%')
);
create index if not exists recipe_pdf_jobs_book_idx on public.recipe_pdf_jobs (book_id, created_at desc);
create index if not exists recipe_pdf_jobs_created_by_idx on public.recipe_pdf_jobs (created_by);
create index if not exists recipe_pdf_jobs_active_idx on public.recipe_pdf_jobs (status, updated_at) where status in ('en_attente','en_cours');

create or replace function public.recipe_pdf_jobs_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace trigger recipe_pdf_jobs_touch before update on public.recipe_pdf_jobs
  for each row execute function public.recipe_pdf_jobs_touch();

-- Carnet d'une analyse (évite la récursion de RLS dans la policy d'insertion de recipe_imports).
create or replace function public.recipe_pdf_job_book_id(j uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select book_id from recipe_pdf_jobs where id = j
$$;

alter table public.recipe_pdf_jobs enable row level security;

-- Lecture : membres. Insertion : éditeurs, à leur nom, chemin dans le dossier de cette analyse. Aucune policy d'update
-- (le client ne modifie jamais une analyse). Suppression : par l'auteur.
do $$
begin
  execute 'drop policy if exists "members read" on public.recipe_pdf_jobs';
  execute 'create policy "members read" on public.recipe_pdf_jobs for select to authenticated
           using (public.is_book_member(book_id))';
  execute 'drop policy if exists "editors insert" on public.recipe_pdf_jobs';
  execute 'create policy "editors insert" on public.recipe_pdf_jobs for insert to authenticated
           with check (public.is_book_editor(book_id) and created_by = (select auth.uid())
                       and pdf_path like book_id::text || ''/imports/'' || id::text || ''/%''
                       and pdf_path not like ''%..%'')';
  execute 'drop policy if exists "author delete" on public.recipe_pdf_jobs';
  execute 'create policy "author delete" on public.recipe_pdf_jobs for delete to authenticated
           using (created_by = (select auth.uid()))';
  -- Droits explicites et minimaux : le statut, l'erreur et le sommaire ne sont jamais écrits par le client.
  execute 'revoke all on public.recipe_pdf_jobs from anon, authenticated';
end $$;
grant select, delete on public.recipe_pdf_jobs to authenticated;
grant insert (id, book_id, created_by, pdf_path) on public.recipe_pdf_jobs to authenticated;
grant all on public.recipe_pdf_jobs to service_role;

-- Suivi en temps réel de l'analyse (le front écoute recipe_pdf_jobs).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recipe_pdf_jobs') then
    alter publication supabase_realtime add table public.recipe_pdf_jobs;
  end if;
end $$;

-- ---------------------------------------------------------------- menus : recipe_menus
create table if not exists public.recipe_menus (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null default public.my_book() references public.recipe_books on delete cascade,
  title text not null check (length(title) between 1 and 200),
  note text check (length(note) <= 2000),
  source_type text not null default 'manuel' check (source_type in ('manuel','pdf')),
  pdf_job_id uuid references public.recipe_pdf_jobs on delete set null,
  deleted_at timestamptz,                                      -- corbeille (30 jours)
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recipe_menus_book_idx on public.recipe_menus (book_id, updated_at desc) where deleted_at is null;
create index if not exists recipe_menus_created_by_idx on public.recipe_menus (created_by);
create index if not exists recipe_menus_pdf_job_idx on public.recipe_menus (pdf_job_id) where pdf_job_id is not null;
create index if not exists recipe_menus_deleted_idx on public.recipe_menus (deleted_at) where deleted_at is not null;
-- Recherche par titre, tolérante aux accents et aux fautes (trigrammes), comme les recettes et les astuces.
create index if not exists recipe_menus_title_trgm_idx on public.recipe_menus using gin (public.f_unaccent(title) extensions.gin_trgm_ops);

-- Carnet d'un menu (security definer : évite la récursion de RLS dans les policies et triggers des tables liées).
create or replace function public.recipe_menu_book_id(m uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select book_id from recipe_menus where id = m
$$;

-- Avant écriture : carnet et auteur non modifiables, analyse du même carnet, updated_at (inchangé si rien d'autre ne change).
create or replace function public.recipe_menus_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.book_id <> old.book_id then
      raise exception 'le carnet d''un menu ne peut pas changer';
    end if;
    new.created_by := old.created_by;
  end if;
  if new.pdf_job_id is not null and public.recipe_pdf_job_book_id(new.pdf_job_id) is distinct from new.book_id then
    raise exception 'l''analyse du PDF doit appartenir au carnet du menu';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
      new.updated_at := old.updated_at;
    else
      new.updated_at := now();
    end if;
  end if;
  return new;
end $$;

create or replace trigger recipe_menus_before_write before insert or update on public.recipe_menus
  for each row execute function public.recipe_menus_before_write();

-- ---------------------------------------------------------------- menus : recipe_menu_items
create table if not exists public.recipe_menu_items (
  menu_id uuid not null references public.recipe_menus on delete cascade,
  recipe_id uuid not null references public.recipes on delete cascade,
  position int not null default 0 check (position >= 0),
  rubrique text not null check (rubrique in
    ('aperitif','entree','plat','accompagnement','fromage','dessert','base','boisson','autre')),
  primary key (menu_id, recipe_id)
);
create index if not exists recipe_menu_items_menu_idx on public.recipe_menu_items (menu_id, position);
create index if not exists recipe_menu_items_recipe_idx on public.recipe_menu_items (recipe_id);

-- La recette d'un menu doit être du même carnet que le menu (security definer : lit recipes sans dépendre de la RLS).
create or replace function public.recipe_menu_items_same_book() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.recipe_menu_book_id(new.menu_id) is distinct from (select book_id from recipes where id = new.recipe_id) then
    raise exception 'la recette doit appartenir au même carnet que le menu';
  end if;
  return new;
end $$;

create or replace trigger recipe_menu_items_same_book before insert or update on public.recipe_menu_items
  for each row execute function public.recipe_menu_items_same_book();

-- ---------------------------------------------------------------- menus : RLS et droits
alter table public.recipe_menus      enable row level security;
alter table public.recipe_menu_items enable row level security;

do $$
begin
  -- Menus : lecture par tous les membres (corbeille comprise, filtrée côté client), écriture par owner et member ;
  -- suppression définitive seulement depuis la corbeille. Comme recipe_tips.
  execute 'drop policy if exists "members read" on public.recipe_menus';
  execute 'create policy "members read" on public.recipe_menus for select to authenticated
           using (public.is_book_member(book_id))';
  execute 'drop policy if exists "editors insert" on public.recipe_menus';
  execute 'create policy "editors insert" on public.recipe_menus for insert to authenticated
           with check (public.is_book_editor(book_id) and created_by = (select auth.uid()))';
  execute 'drop policy if exists "editors update" on public.recipe_menus';
  execute 'create policy "editors update" on public.recipe_menus for update to authenticated
           using (public.is_book_editor(book_id)) with check (public.is_book_editor(book_id))';
  execute 'drop policy if exists "editors delete trashed" on public.recipe_menus';
  execute 'create policy "editors delete trashed" on public.recipe_menus for delete to authenticated
           using (public.is_book_editor(book_id) and deleted_at is not null)';

  -- Recettes d'un menu : lecture membres, écriture éditeurs, via le carnet du menu.
  execute 'drop policy if exists "members read" on public.recipe_menu_items';
  execute 'create policy "members read" on public.recipe_menu_items for select to authenticated
           using (public.is_book_member(public.recipe_menu_book_id(menu_id)))';
  execute 'drop policy if exists "editors insert" on public.recipe_menu_items';
  execute 'create policy "editors insert" on public.recipe_menu_items for insert to authenticated
           with check (public.is_book_editor(public.recipe_menu_book_id(menu_id)))';
  execute 'drop policy if exists "editors update" on public.recipe_menu_items';
  execute 'create policy "editors update" on public.recipe_menu_items for update to authenticated
           using (public.is_book_editor(public.recipe_menu_book_id(menu_id)))
           with check (public.is_book_editor(public.recipe_menu_book_id(menu_id)))';
  execute 'drop policy if exists "editors delete" on public.recipe_menu_items';
  execute 'create policy "editors delete" on public.recipe_menu_items for delete to authenticated
           using (public.is_book_editor(public.recipe_menu_book_id(menu_id)))';

  -- Aucun accès anonyme ; la RLS reste le garde-fou ligne par ligne.
  execute 'revoke all on public.recipe_menus, public.recipe_menu_items from anon';
  -- Fonctions internes : jamais exposées à anon, appelables par les policies (authenticated).
  execute 'revoke execute on function public.recipe_menu_book_id(uuid), public.recipe_pdf_job_book_id(uuid) from anon, public';
  execute 'revoke execute on function public.recipe_menus_before_write(), public.recipe_menu_items_same_book(),
           public.recipe_pdf_jobs_touch() from anon, authenticated, public';
end $$;
grant select, insert, update, delete on public.recipe_menus, public.recipe_menu_items to authenticated;
grant all on public.recipe_menus, public.recipe_menu_items to service_role;
grant execute on function public.recipe_menu_book_id(uuid), public.recipe_pdf_job_book_id(uuid) to authenticated;

-- ---------------------------------------------------------------- recipe_imports : extrait d'un PDF
alter table public.recipe_imports add column if not exists pdf_job_id uuid references public.recipe_pdf_jobs on delete set null;
alter table public.recipe_imports add column if not exists pdf_idx int check (pdf_idx >= 0);        -- entrée du sommaire (toc[].idx)
alter table public.recipe_imports add column if not exists menu_id uuid references public.recipe_menus on delete set null;
alter table public.recipe_imports add column if not exists menu_position int check (menu_position >= 0);
alter table public.recipe_imports add column if not exists menu_rubrique text check (menu_rubrique in
  ('aperitif','entree','plat','accompagnement','fromage','dessert','base','boisson','autre'));
create index if not exists recipe_imports_pdf_job_idx on public.recipe_imports (pdf_job_id, pdf_idx) where pdf_job_id is not null;
create index if not exists recipe_imports_menu_idx on public.recipe_imports (menu_id) where menu_id is not null;

-- kind accepte 'pdf_extrait' ; la cohérence de source gagne une branche. Les contraintes en place sont retrouvées par leur
-- nom ou leur définition (comme recettes-note.sql), remplacées seulement si elles ignorent encore 'pdf_extrait'.
do $$
declare c record; d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint
   where conrelid = 'public.recipe_imports'::regclass and conname = 'recipe_imports_kind_chk';
  if d is null or position('pdf_extrait' in d) = 0 then
    for c in
      select con.conname from pg_constraint con
       where con.conrelid = 'public.recipe_imports'::regclass and con.contype = 'c'
         and (con.conname = 'recipe_imports_kind_chk' or pg_get_constraintdef(con.oid) ~ '^CHECK \(\(?kind = ANY')
    loop
      execute format('alter table public.recipe_imports drop constraint %I', c.conname);
    end loop;
    execute $q$alter table public.recipe_imports add constraint recipe_imports_kind_chk
      check (kind in ('instagram','web','photo_page','texte','pdf_extrait'))$q$;
  end if;

  select pg_get_constraintdef(oid) into d from pg_constraint
   where conrelid = 'public.recipe_imports'::regclass and conname = 'recipe_imports_source_chk';
  if d is null or position('pdf_extrait' in d) = 0 then
    execute 'alter table public.recipe_imports drop constraint if exists recipe_imports_source_chk';
    -- Un lien pour instagram/web, 1 à 4 photos pour photo_page, un texte (et 0 à 6 photos) pour texte,
    -- et pour pdf_extrait : l'analyse et l'entrée du sommaire, aucune autre source.
    execute $q$alter table public.recipe_imports add constraint recipe_imports_source_chk check (
      (kind = 'texte' and source_text is not null and length(btrim(source_text)) > 0 and source_url is null
         and cardinality(page_paths) = 0)
      or (kind = 'photo_page' and cardinality(page_paths) between 1 and 4 and source_text is null and cardinality(photo_paths) = 0)
      or (kind in ('instagram','web') and source_url is not null and source_text is null and cardinality(photo_paths) = 0)
      or (kind = 'pdf_extrait' and pdf_job_id is not null and pdf_idx is not null and source_url is null
          and source_text is null and cardinality(page_paths) = 0 and cardinality(photo_paths) = 0)
    )$q$;
  end if;
end $$;

-- Insertion : mêmes contrôles qu'avant (recettes-note.sql) ; pour un extrait de PDF, l'analyse doit être du même carnet ;
-- si un menu est indiqué, il doit l'être aussi.
do $$
begin
  execute 'drop policy if exists "editors insert" on public.recipe_imports';
  execute 'create policy "editors insert" on public.recipe_imports for insert to authenticated
    with check (
      public.is_book_editor(book_id) and created_by = (select auth.uid())
      and not exists (
        select 1 from unnest(page_paths) p
         where p not like book_id::text || ''/imports/'' || id::text || ''/%''
            or p like ''%..%'')
      and not exists (
        select 1 from unnest(photo_paths) p
         where p is null
            or p not like book_id::text || ''/imports/'' || id::text || ''/%''
            or p like ''%..%'')
      and (kind <> ''pdf_extrait'' or public.recipe_pdf_job_book_id(pdf_job_id) = book_id)
      and (menu_id is null or public.recipe_menu_book_id(menu_id) = book_id)
    )';
end $$;

-- Droit d'insertion par colonnes : additif (les colonnes existantes, target compris, restent).
grant insert (pdf_job_id, pdf_idx, menu_id, menu_position, menu_rubrique) on public.recipe_imports to authenticated;

-- ---------------------------------------------------------------- planning : une case peut porter un menu
alter table public.recipe_meal_plan add column if not exists menu_id uuid references public.recipe_menus on delete set null;
create index if not exists recipe_meal_plan_menu_idx on public.recipe_meal_plan (menu_id) where menu_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.recipe_meal_plan'::regclass and conname = 'recipe_meal_plan_recipe_or_menu_chk') then
    execute 'alter table public.recipe_meal_plan add constraint recipe_meal_plan_recipe_or_menu_chk
             check (not (recipe_id is not null and menu_id is not null))';
  end if;
end $$;

-- Même fonction qu'en phase 5, complétée : le menu d'une case doit appartenir au carnet du planning.
create or replace function public.recipe_meal_plan_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.recipe_id is not null and (select book_id from recipes where id = new.recipe_id) is distinct from new.book_id then
    raise exception 'la recette doit appartenir au carnet du planning';
  end if;
  if new.menu_id is not null and public.recipe_menu_book_id(new.menu_id) is distinct from new.book_id then
    raise exception 'le menu doit appartenir au carnet du planning';
  end if;
  if tg_op = 'UPDATE' and new.book_id <> old.book_id then
    raise exception 'le carnet d''une case ne peut pas changer';
  end if;
  new.updated_at := now();
  return new;
end $$;

grant insert (menu_id) on public.recipe_meal_plan to authenticated;
grant update (menu_id) on public.recipe_meal_plan to authenticated;

-- ---------------------------------------------------------------- courses : recipe_shopping_add_plan()
-- La définition en place (recettes-phase5.sql) est relue et complétée d'un second parcours : chaque case « menu » de la
-- période ajoute, dans l'ordre du menu, les recettes du menu (hors corbeille et archives) pour les convives de la case.
-- Sans effet si le traitement des menus y est déjà.
do $$
declare d text; a text := 'return tot;';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recipe_shopping_add_plan';
  if d is null then raise exception 'recipe_shopping_add_plan absente'; end if;
  if position('recipe_menu_items' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'point d''insertion introuvable dans recipe_shopping_add_plan'; end if;
  execute replace(d, a, $q$-- Cases « menu » : toutes les recettes du menu, mêmes convives que la case.
  declare pm record; mi record;
  begin
    for pm in
      select m.id, m.menu_id, m.servings from recipe_meal_plan m join recipe_menus mn on mn.id = m.menu_id
       where m.book_id = p_book and m.day between p_from and p_to and mn.deleted_at is null
       order by m.day, m.slot
    loop
      for mi in
        select i.recipe_id from recipe_menu_items i join recipes rc on rc.id = i.recipe_id
         where i.menu_id = pm.menu_id and rc.deleted_at is null and rc.archived_at is null
         order by i.position, rc.title
      loop
        r := public.recipe_shopping_push(p_book, mi.recipe_id, pm.servings, pm.id);
        tot := jsonb_build_object(
          'added', (tot->>'added')::int + (r->>'added')::int,
          'merged', (tot->>'merged')::int + (r->>'merged')::int,
          'skipped', (tot->>'skipped')::int + (r->>'skipped')::int,
          'recipes', (tot->>'recipes')::int + 1);
      end loop;
    end loop;
  end;
  $q$ || a);
end $$;

-- ---------------------------------------------------------------- réceptions : recipe_plan_to_reception()
-- Même principe (définition de recettes-phase7.sql relue et complétée) : une case « menu » ajoute aux plats de la
-- réception chaque recette du menu qui n'y figure pas déjà (rubrique du menu ; accompagnement, base et boisson deviennent
-- « autre », la réception ne connaissant pas ces rubriques). Aucun plat n'est jamais retiré. Sans effet si déjà fait.
do $$
declare d text; a text := 'update recipe_meal_plan set reception_id = rid';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recipe_plan_to_reception';
  if d is null then raise exception 'recipe_plan_to_reception absente'; end if;
  if position('recipe_menu_items' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'point d''insertion introuvable dans recipe_plan_to_reception'; end if;
  execute replace(d, a, $q$if p.menu_id is not null then
    declare mi record;
    begin
      for mi in
        select i.recipe_id, r2.title, i.rubrique from recipe_menu_items i
          join recipes r2 on r2.id = i.recipe_id join recipe_menus mn on mn.id = i.menu_id
         where i.menu_id = p.menu_id and mn.deleted_at is null and r2.deleted_at is null and r2.archived_at is null
         order by i.position, r2.title
      loop
        if not exists (select 1 from recipe_reception_dishes where reception_id = rid and recipe_id = mi.recipe_id) then
          insert into recipe_reception_dishes (reception_id, recipe_id, label, course, position)
          values (rid, mi.recipe_id, mi.title,
                  case when mi.rubrique in ('aperitif', 'entree', 'plat', 'fromage', 'dessert') then mi.rubrique else 'autre' end,
                  coalesce((select max(position) + 1 from recipe_reception_dishes where reception_id = rid), 0));
        end if;
      end loop;
    end;
  end if;

  $q$ || a);
end $$;

-- ---------------------------------------------------------------- corbeille
-- Même fonction qu'en recettes-astuces.sql, étendue : supprime aussi les menus en corbeille depuis plus de 30 jours
-- (recettes du menu en cascade ; imports et cases du planning pointant sur le menu : lien vidé). Renvoie le total supprimé
-- (recettes + astuces + menus). Les droits d'exécution existants sont conservés par « create or replace ».
create or replace function public.purge_recipe_trash() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; m integer; k integer;
begin
  with d as (delete from recipes where deleted_at is not null and deleted_at < now() - interval '30 days' returning 1)
  select count(*) into n from d;
  with d as (delete from recipe_tips where deleted_at is not null and deleted_at < now() - interval '30 days' returning 1)
  select count(*) into m from d;
  with d as (delete from recipe_menus where deleted_at is not null and deleted_at < now() - interval '30 days' returning 1)
  select count(*) into k from d;
  return n + m + k;
end $$;

-- ---------------------------------------------------------------- stockage
-- Le bucket « recipes » accepte des PDF jusqu'à 30 Mo (31 457 280 octets). Rappel : la limite globale de taille d'un
-- fichier (Storage > Settings) plafonne aussi celle du bucket ; elle doit être d'au moins 30 Mo.
update storage.buckets set file_size_limit = 31457280 where id = 'recipes';
