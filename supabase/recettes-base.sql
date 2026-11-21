-- ARÔMES V&N · type de plat « base » (sauces, fonds, pâtes, crèmes, condiments). Cadrage §2 (ajout du 21.11.2026).
-- Rejouable. À appliquer après recettes-phase7.sql. Ne touche qu'à recipes.course et à recipe_suggestions().
-- Les remplacements passent par des blocs DO (instructions dynamiques).

-- recipes.course accepte « base » : la contrainte existante est retrouvée par sa définition, puis recréée sous un nom fixe.
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.recipes'::regclass and con.contype = 'c'
       and (con.conname = 'recipes_course_chk' or pg_get_constraintdef(con.oid) ~ '^CHECK \(\(?course = ANY')
  loop
    execute format('alter table public.recipes drop constraint %I', c.conname);
  end loop;
  execute $q$alter table public.recipes add constraint recipes_course_chk
    check (course in ('entree','plat','dessert','accompagnement','base','boisson','autre'))$q$;
end $$;

-- Suggestions (et « Remplir ma semaine ») : une base ne se propose pas comme repas. La définition en place
-- (recettes-phase7.sql) est relue et complétée d'un filtre, sans la recopier ; sans effet si le filtre y est déjà.
do $$
declare d text; f text := 'and r.review_state = ''valide''';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recipe_suggestions';
  if d is null then raise exception 'recipe_suggestions absente'; end if;
  if position('course is distinct from ''base''' in d) > 0 then return; end if;
  if position(f in d) = 0 then raise exception 'filtre des candidats introuvable dans recipe_suggestions'; end if;
  execute replace(d, f, f || ' and r.course is distinct from ''base''');
end $$;
