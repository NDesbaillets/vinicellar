-- ARÔMES V&N · « Ce soir », suggestions par type de plat, composer un menu. Contrat : docs/recettes/10-ce-soir-composer-contrat.md §1.
-- Rejouable. À appliquer après recettes-menus.sql. Applicable depuis un téléphone : ce script ne contient aucune
-- instruction destructive. Aucune signature de fonction existante n'est modifiée.
-- Objets touchés : recipes (colonne courses_alt), recipe_search (filtre p_course, par relecture de la définition) ;
-- créés : recipe_suggest_courses, recipe_tonight.

-- ---------------------------------------------------------------- recipes.courses_alt
-- « Peut aussi être servi en » : salade César = entree + {plat}. Hors recherche plein texte.
alter table public.recipes add column if not exists courses_alt text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.recipes'::regclass and conname = 'recipes_courses_alt_chk') then
    execute $q$alter table public.recipes add constraint recipes_courses_alt_chk
      check (courses_alt <@ array['entree','plat','dessert','accompagnement','base','boisson','autre']::text[]
             and not (course = any(courses_alt)))$q$;
  end if;
end $$;

create index if not exists recipes_courses_alt_idx on public.recipes using gin (courses_alt) where cardinality(courses_alt) > 0;

-- ---------------------------------------------------------------- recipe_search : p_course inclut courses_alt
-- La définition en place (recettes-phase4.sql) est relue et complétée, sans la recopier ; sans effet si déjà fait.
do $$
declare d text; f text := '(p_course is null or r.course = p_course)';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recipe_search';
  if d is null then raise exception 'recipe_search absente'; end if;
  if position('courses_alt' in d) > 0 then return; end if;
  if position(f in d) = 0 then raise exception 'filtre p_course introuvable dans recipe_search'; end if;
  execute replace(d, f, '(p_course is null or r.course = p_course or p_course = any(r.courses_alt))');
end $$;

-- ---------------------------------------------------------------- recipe_suggest_courses
-- Comme recipe_suggestions (mêmes paramètres, même ordre), restreint aux types demandés : course dans p_courses,
-- ou courses_alt qui en recoupe un ; les recettes sans type comptent comme « plat ». Les bases restent exclues
-- par recipe_suggestions. Sortie : celle de recipe_suggestions + course.
create or replace function public.recipe_suggest_courses(
  p_book_ids uuid[],
  p_for_users uuid[] default null,
  p_month int default extract(month from (now() at time zone 'Europe/Zurich'))::int,
  p_limit int default 12,
  p_weekday boolean default (extract(isodow from (now() at time zone 'Europe/Zurich')) <= 5),
  p_guest_ids uuid[] default null,
  p_hide_served boolean default false,
  p_courses text[] default array['plat']
)
returns table (recipe_id uuid, score numeric, raisons text[], deja_servi text, course text)
language plpgsql stable security invoker set search_path = public as $$
#variable_conflict use_column
declare
  lim int := least(greatest(coalesce(p_limit, 12), 1), 100);
  crs text[] := coalesce(nullif(p_courses, '{}'), array['plat']);
begin
  if auth.uid() is null then return; end if;
  return query
  select s.recipe_id, s.score, s.raisons, s.deja_servi, r.course
    from public.recipe_suggestions(p_book_ids, p_for_users, p_month, 100, p_weekday, p_guest_ids, p_hide_served)
         with ordinality as s(recipe_id, score, raisons, deja_servi, ord)
    join recipes r on r.id = s.recipe_id
   where r.course = any(crs)
      or r.courses_alt && crs
      or (r.course is null and 'plat' = any(crs))
   order by s.ord
   limit lim;
end $$;

-- ---------------------------------------------------------------- recipe_tonight
-- La case « soir » d'aujourd'hui (Europe/Zurich) du carnet, avec le titre de la recette ou du menu ; rien si absente.
create or replace function public.recipe_tonight(p_book uuid)
returns table (plan_id uuid, state text, recipe_id uuid, menu_id uuid, servings int, title text)
language sql stable security invoker set search_path = public as $$
  select m.id, m.state, m.recipe_id, m.menu_id, m.servings, coalesce(r.title, mn.title)
    from recipe_meal_plan m
    left join recipes r on r.id = m.recipe_id
    left join recipe_menus mn on mn.id = m.menu_id
   where m.book_id = p_book
     and m.day = (now() at time zone 'Europe/Zurich')::date
     and m.slot = 'soir'
     and auth.uid() is not null
   limit 1;
$$;

grant execute on function
  public.recipe_suggest_courses(uuid[], uuid[], int, int, boolean, uuid[], boolean, text[]),
  public.recipe_tonight(uuid)
  to authenticated;
