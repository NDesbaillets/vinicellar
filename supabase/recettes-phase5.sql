-- ARÔMES V&N · phase 5 « Organiser » : planning, liste de courses partagée, notifications.
-- Rejouable (idempotent). À exécuter dans Supabase > SQL Editor, APRÈS recettes.sql, recettes-phase2.sql et
-- recettes-phase3.sql. Si recettes-phase2.sql est appliqué plus tard, rejouer ce fichier (le déclencheur « fin d'import »
-- n'est créé que si la table recipe_imports existe).
-- Ne modifie aucune table ni fonction de la cave ni des phases précédentes : tout est préfixé recipe_ ; la RLS est
-- activée dès la création de chaque table. Aucun droit pour anon.
-- Contrat front : docs/recettes/05-organiser-contrat.md. Cadrage : docs/recettes/01-cadrage.md §5.

-- ---------------------------------------------------------------- planning : recipe_meal_plan
-- Une case = un jour et un créneau (midi ou soir) d'un carnet. Lecture : membres ; écriture : owner et member.
create table if not exists public.recipe_meal_plan (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.recipe_books on delete cascade,
  day date not null,
  slot text not null check (slot in ('midi','soir')),
  state text not null default 'prevu' check (state in ('prevu','dehors','travail','invites')),
  recipe_id uuid references public.recipes on delete set null,
  servings int check (servings > 0),                           -- convives
  note text check (length(note) <= 500),
  created_by uuid default auth.uid() references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  unique (book_id, day, slot)
);
create index if not exists recipe_meal_plan_recipe_idx on public.recipe_meal_plan (recipe_id) where recipe_id is not null;
create index if not exists recipe_meal_plan_created_by_idx on public.recipe_meal_plan (created_by);

-- Avant écriture : la recette d'une case doit appartenir au même carnet ; updated_at tenu à jour.
create or replace function public.recipe_meal_plan_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.recipe_id is not null and (select book_id from recipes where id = new.recipe_id) is distinct from new.book_id then
    raise exception 'la recette doit appartenir au carnet du planning';
  end if;
  if tg_op = 'UPDATE' and new.book_id <> old.book_id then
    raise exception 'le carnet d''une case ne peut pas changer';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.recipe_meal_plan_before_write() from anon, authenticated, public;

drop trigger if exists recipe_meal_plan_before_write on public.recipe_meal_plan;
create trigger recipe_meal_plan_before_write before insert or update on public.recipe_meal_plan
  for each row execute function public.recipe_meal_plan_before_write();

alter table public.recipe_meal_plan enable row level security;

drop policy if exists "members read" on public.recipe_meal_plan;
create policy "members read" on public.recipe_meal_plan for select to authenticated
  using (public.is_book_member(book_id));
drop policy if exists "editors insert" on public.recipe_meal_plan;
create policy "editors insert" on public.recipe_meal_plan for insert to authenticated
  with check (public.is_book_editor(book_id) and created_by = (select auth.uid()));
drop policy if exists "editors update" on public.recipe_meal_plan;
create policy "editors update" on public.recipe_meal_plan for update to authenticated
  using (public.is_book_editor(book_id)) with check (public.is_book_editor(book_id));
drop policy if exists "editors delete" on public.recipe_meal_plan;
create policy "editors delete" on public.recipe_meal_plan for delete to authenticated
  using (public.is_book_editor(book_id));

revoke all on public.recipe_meal_plan from anon, authenticated;
grant select, delete on public.recipe_meal_plan to authenticated;
grant insert (id, book_id, day, slot, state, recipe_id, servings, note, created_by) on public.recipe_meal_plan to authenticated;
grant update (day, slot, state, recipe_id, servings, note) on public.recipe_meal_plan to authenticated;

-- « Reprendre le rythme de la semaine dernière » : recopie les cases (jour, créneau, état, convives) d'une semaine
-- sur une autre, sans les recettes ni les notes. Les semaines sont ramenées à leur lundi (n'importe quel jour de la
-- semaine convient). Une case déjà présente dans la semaine cible n'est jamais écrasée. Renvoie le nombre de cases créées.
create or replace function public.recipe_plan_copy_rhythm(p_book uuid, p_from_week date, p_to_week date)
returns integer
language plpgsql security definer set search_path = public as $$
declare f date; t date; n integer;
begin
  if not public.is_book_editor(p_book) then raise exception 'droits insuffisants' using errcode = '42501'; end if;
  if p_from_week is null or p_to_week is null then raise exception 'semaines requises'; end if;
  f := date_trunc('week', p_from_week)::date;
  t := date_trunc('week', p_to_week)::date;
  if f = t then raise exception 'les deux semaines sont identiques'; end if;
  insert into recipe_meal_plan (book_id, day, slot, state, servings, created_by)
  select p_book, d.day + (t - f), d.slot, d.state, d.servings, auth.uid()
    from recipe_meal_plan d
   where d.book_id = p_book and d.day >= f and d.day < f + 7
  on conflict (book_id, day, slot) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- liste de courses : recipe_shopping_items
-- Écriture réservée aux éditeurs (owner, member), cocher et décocher compris : le cadrage ne prévoit pas d'exception
-- pour le lecteur (« reader : consulter, annoter, enregistrer ses cuissons »). Voir le point ouvert du contrat.
create table if not exists public.recipe_shopping_items (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.recipe_books on delete cascade,
  catalog_id uuid references public.recipe_ingredients_catalog on delete set null,
  label text not null check (length(label) between 1 and 300),
  quantity numeric check (quantity >= 0),
  unit text check (unit in ('g','kg','ml','cl','l','cas','cac','piece','pincee','botte','gousse','tranche')),
  aisle text not null default 'autre' check (aisle in
    ('fruits_legumes','boucherie','poissonnerie','cremerie','epicerie','epices','boulangerie','surgeles','boissons','autre')),
  checked boolean not null default false,
  checked_by uuid references auth.users on delete set null,
  checked_at timestamptz,
  added_by uuid default auth.uid() references auth.users on delete set null,
  source_recipe_id uuid references public.recipes on delete set null,
  source_plan_id uuid references public.recipe_meal_plan on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists recipe_shopping_items_book_idx on public.recipe_shopping_items (book_id, checked, aisle);
create index if not exists recipe_shopping_items_catalog_idx on public.recipe_shopping_items (book_id, catalog_id) where catalog_id is not null;
create index if not exists recipe_shopping_items_checked_by_idx on public.recipe_shopping_items (checked_by) where checked_by is not null;
create index if not exists recipe_shopping_items_added_by_idx on public.recipe_shopping_items (added_by);
create index if not exists recipe_shopping_items_recipe_idx on public.recipe_shopping_items (source_recipe_id) where source_recipe_id is not null;
create index if not exists recipe_shopping_items_plan_idx on public.recipe_shopping_items (source_plan_id) where source_plan_id is not null;

-- Qui a coché et quand : posé par le serveur (les colonnes ne sont pas modifiables par le client).
create or replace function public.recipe_shopping_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.book_id <> old.book_id then
    raise exception 'le carnet d''un article ne peut pas changer';
  end if;
  if new.checked and (tg_op = 'INSERT' or not old.checked) then
    new.checked_by := auth.uid();
    new.checked_at := now();
  elsif not new.checked then
    new.checked_by := null;
    new.checked_at := null;
  elsif tg_op = 'UPDATE' then
    new.checked_by := old.checked_by;
    new.checked_at := old.checked_at;
  end if;
  return new;
end $$;
revoke execute on function public.recipe_shopping_before_write() from anon, authenticated, public;

drop trigger if exists recipe_shopping_before_write on public.recipe_shopping_items;
create trigger recipe_shopping_before_write before insert or update on public.recipe_shopping_items
  for each row execute function public.recipe_shopping_before_write();

alter table public.recipe_shopping_items enable row level security;

drop policy if exists "members read" on public.recipe_shopping_items;
create policy "members read" on public.recipe_shopping_items for select to authenticated
  using (public.is_book_member(book_id));
drop policy if exists "editors insert" on public.recipe_shopping_items;
create policy "editors insert" on public.recipe_shopping_items for insert to authenticated
  with check (public.is_book_editor(book_id) and added_by = (select auth.uid()));
drop policy if exists "editors update" on public.recipe_shopping_items;
create policy "editors update" on public.recipe_shopping_items for update to authenticated
  using (public.is_book_editor(book_id)) with check (public.is_book_editor(book_id));
drop policy if exists "editors delete" on public.recipe_shopping_items;
create policy "editors delete" on public.recipe_shopping_items for delete to authenticated
  using (public.is_book_editor(book_id));

revoke all on public.recipe_shopping_items from anon, authenticated;
grant select, delete on public.recipe_shopping_items to authenticated;
grant insert (id, book_id, catalog_id, label, quantity, unit, aisle, checked, added_by) on public.recipe_shopping_items to authenticated;
grant update (catalog_id, label, quantity, unit, aisle, checked) on public.recipe_shopping_items to authenticated;

-- ---------------------------------------------------------------- courses : mise à l'échelle et fusion
-- Mise à l'échelle d'une quantité (facteur f = convives voulus / portions de la recette), règles d'arrondi de
-- docs/recettes/03-cuisiner-contrat.md §5. Écart assumé : sur une liste de courses, une cuillère qui arrondirait à
-- zéro devient 0,5 (pas de « pointe » affichable). Facteur 1, quantité vide et pincée : inchangés.
create or replace function public.recipe_scale_qty(q numeric, u text, f numeric, out o_q numeric, out o_u text)
language plpgsql immutable set search_path = '' as $$
declare v numeric; base numeric; orig_cl boolean;
begin
  o_q := q; o_u := u;
  if q is null or f is null or f = 1 or u = 'pincee' then return; end if;
  v := q * f;
  if u is null or u in ('piece','gousse','botte','tranche') then
    o_q := floor(v + 0.5);
    if o_q < 1 and q > 0 then o_q := 1; end if;
  elsif u in ('cas','cac') then
    o_q := round(v * 2) / 2;
    if o_q < 0.5 and q > 0 then o_q := 0.5; end if;
  elsif u in ('kg','l') and v >= 1 then
    o_q := round(v, 1);
  else
    -- g, ml, cl, et kg / l inférieurs à 1 : arrondi en g / ml
    orig_cl := (u = 'cl');
    base := case u when 'kg' then v * 1000 when 'l' then v * 1000 when 'cl' then v * 10 else v end;
    base := case when base < 100 then round(base / 5) * 5 else round(base / 10) * 10 end;
    if base < 5 and q > 0 then base := 5; end if;
    if base >= 1000 then
      o_q := trim_scale(base / 1000); o_u := case when u in ('g','kg') then 'kg' else 'l' end;
    elsif orig_cl and base % 10 = 0 then
      o_q := base / 10; o_u := 'cl';
    else
      o_q := base; o_u := case when u in ('g','kg') then 'g' else 'ml' end;
    end if;
  end if;
end $$;

-- Famille d'unités compatibles (conversion possible) et valeur en unité de base (g ou ml).
create or replace function public.recipe_unit_family(u text) returns text
language sql immutable set search_path = '' as $$
  select case when u in ('g','kg') then 'masse' when u in ('ml','cl','l') then 'volume' else u end
$$;
create or replace function public.recipe_unit_base(q numeric, u text) returns numeric
language sql immutable set search_path = '' as $$
  select case u when 'kg' then q * 1000 when 'l' then q * 1000 when 'cl' then q * 10 else q end
$$;

-- Ingrédients jamais portés sur la liste : sel, poivre, eau (nom du catalogue, alias ou libellé d'origine).
create or replace function public.recipe_shopping_is_excluded(p_name text, p_aliases text[]) returns boolean
language sql immutable set search_path = public as $$
  select exists (
    select 1 from unnest(array[p_name] || coalesce(p_aliases, '{}')) as n(v)
     where lower(btrim(public.f_unaccent(coalesce(v, '')))) ~
       '^(sel|sel fin|gros sel|fleur de sel|sel de mer|sel et poivre|sel, poivre|poivre|poivre noir|poivre blanc|poivre du moulin|poivre moulu|eau|eau froide|eau chaude|eau tiede|eau bouillante|eau glacee|eau du robinet)$')
$$;

-- Ajoute les lignes d'une recette à la liste du carnet (fonction interne, appelée par les deux fonctions publiques).
-- Renvoie {added, merged, skipped}. Fusion avec les articles NON cochés de même ingrédient (catalog_id, ou libellé
-- identique quand l'ingrédient n'est pas au catalogue) et d'unité compatible ; sinon nouvelle ligne.
create or replace function public.recipe_shopping_push(p_book uuid, p_recipe uuid, p_servings int, p_plan uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rec record; l record; ex record;
  f numeric := 1; lbl text; fam text; sq numeric; su text; tot numeric; nq numeric; nu text;
  added int := 0; merged int := 0; skipped int := 0;
begin
  select id, book_id, servings, deleted_at, archived_at into rec from recipes where id = p_recipe;
  if rec.id is null or rec.book_id <> p_book then raise exception 'recette introuvable dans ce carnet'; end if;
  if rec.deleted_at is not null or rec.archived_at is not null then raise exception 'recette en corbeille ou archivée'; end if;
  if coalesce(p_servings, rec.servings) is not null and rec.servings is not null then
    f := coalesce(p_servings, rec.servings)::numeric / rec.servings;
  end if;

  for l in
    select il.catalog_id, il.label_original, il.quantity, il.unit,
           c.name as cname, c.aliases, coalesce(c.aisle, 'autre') as aisle
      from recipe_ingredient_lines il left join recipe_ingredients_catalog c on c.id = il.catalog_id
     where il.recipe_id = p_recipe and not il.optional
     order by il.position, il.id
  loop
    if public.recipe_shopping_is_excluded(coalesce(l.cname, l.label_original), l.aliases)
       or public.recipe_shopping_is_excluded(l.label_original, null) then
      skipped := skipped + 1; continue;
    end if;
    lbl := left(coalesce(l.cname, l.label_original), 300);
    select o_q, o_u into sq, su from public.recipe_scale_qty(l.quantity, l.unit, f);
    fam := public.recipe_unit_family(su);

    -- article non coché de même ingrédient
    ex := null;
    if sq is null then
      -- quantité inconnue (q.b.) : rien à ajouter si l'ingrédient est déjà sur la liste
      select i.* into ex from recipe_shopping_items i
       where i.book_id = p_book and not i.checked
         and ((l.catalog_id is not null and i.catalog_id = l.catalog_id)
              or (l.catalog_id is null and i.catalog_id is null and lower(public.f_unaccent(i.label)) = lower(public.f_unaccent(lbl))))
       order by i.created_at limit 1;
      if ex.id is not null then merged := merged + 1; continue; end if;
    elsif su = 'pincee' then
      -- une pincée reste une pincée : jamais additionnée
      select i.* into ex from recipe_shopping_items i
       where i.book_id = p_book and not i.checked and i.unit = 'pincee'
         and ((l.catalog_id is not null and i.catalog_id = l.catalog_id)
              or (l.catalog_id is null and i.catalog_id is null and lower(public.f_unaccent(i.label)) = lower(public.f_unaccent(lbl))))
       order by i.created_at limit 1;
      if ex.id is not null then merged := merged + 1; continue; end if;
    else
      -- unité compatible d'abord, à défaut une ligne sans quantité (q.b.) qu'on complète
      select i.* into ex from recipe_shopping_items i
       where i.book_id = p_book and not i.checked
         and ((l.catalog_id is not null and i.catalog_id = l.catalog_id)
              or (l.catalog_id is null and i.catalog_id is null and lower(public.f_unaccent(i.label)) = lower(public.f_unaccent(lbl))))
         and ((i.quantity is not null and public.recipe_unit_family(i.unit) is not distinct from fam) or i.quantity is null)
       order by (i.quantity is null), i.created_at limit 1;
      if ex.id is not null then
        if ex.quantity is null then
          update recipe_shopping_items set quantity = sq, unit = su where id = ex.id;
        elsif fam in ('masse','volume') then
          tot := public.recipe_unit_base(ex.quantity, ex.unit) + public.recipe_unit_base(sq, su);
          if tot >= 1000 then nq := trim_scale(round(tot / 1000, 3)); nu := case fam when 'masse' then 'kg' else 'l' end;
          elsif ex.unit = 'cl' and su = 'cl' then nq := trim_scale(round(tot / 10, 3)); nu := 'cl';
          else nq := trim_scale(round(tot, 3)); nu := case fam when 'masse' then 'g' else 'ml' end;
          end if;
          update recipe_shopping_items set quantity = nq, unit = nu where id = ex.id;
        else
          update recipe_shopping_items set quantity = trim_scale(ex.quantity + sq) where id = ex.id;
        end if;
        merged := merged + 1; continue;
      end if;
    end if;

    insert into recipe_shopping_items (book_id, catalog_id, label, quantity, unit, aisle, added_by, source_recipe_id, source_plan_id)
    values (p_book, l.catalog_id, lbl, sq, su, l.aisle, auth.uid(), p_recipe, p_plan);
    added := added + 1;
  end loop;
  return jsonb_build_object('added', added, 'merged', merged, 'skipped', skipped);
end $$;
revoke execute on function public.recipe_shopping_push(uuid, uuid, int, uuid) from anon, authenticated, public;

-- Ajoute les ingrédients d'une recette (lignes « optional », sel, poivre et eau exclus) pour p_servings convives
-- (null : portions de la recette). Éditeurs seulement. Renvoie {added, merged, skipped}.
create or replace function public.recipe_shopping_add_recipe(p_book uuid, p_recipe uuid, p_servings int default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_book_editor(p_book) then raise exception 'droits insuffisants' using errcode = '42501'; end if;
  if p_servings is not null and p_servings < 1 then raise exception 'nombre de convives invalide'; end if;
  perform pg_advisory_xact_lock(hashtext('recipe_shopping:' || p_book::text));
  return public.recipe_shopping_push(p_book, p_recipe, p_servings, null);
end $$;

-- Ajoute toutes les recettes planifiées entre deux dates incluses (31 jours au plus), chacune pour les convives de sa
-- case (à défaut, les portions de la recette). Éditeurs seulement. Renvoie {added, merged, skipped, recipes}.
create or replace function public.recipe_shopping_add_plan(p_book uuid, p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record; r jsonb; tot jsonb := jsonb_build_object('added', 0, 'merged', 0, 'skipped', 0, 'recipes', 0);
begin
  if not public.is_book_editor(p_book) then raise exception 'droits insuffisants' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then raise exception 'période invalide (31 jours au plus)'; end if;
  perform pg_advisory_xact_lock(hashtext('recipe_shopping:' || p_book::text));
  for p in
    select m.id, m.recipe_id, m.servings from recipe_meal_plan m join recipes rc on rc.id = m.recipe_id
     where m.book_id = p_book and m.day between p_from and p_to and rc.deleted_at is null and rc.archived_at is null
     order by m.day, m.slot
  loop
    r := public.recipe_shopping_push(p_book, p.recipe_id, p.servings, p.id);
    tot := jsonb_build_object(
      'added', (tot->>'added')::int + (r->>'added')::int,
      'merged', (tot->>'merged')::int + (r->>'merged')::int,
      'skipped', (tot->>'skipped')::int + (r->>'skipped')::int,
      'recipes', (tot->>'recipes')::int + 1);
  end loop;
  return tot;
end $$;

-- ---------------------------------------------------------------- notifications : abonnements push
create table if not exists public.recipe_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique check (length(endpoint) between 10 and 2000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists recipe_push_subscriptions_user_idx on public.recipe_push_subscriptions (user_id);

alter table public.recipe_push_subscriptions enable row level security;
drop policy if exists "own read" on public.recipe_push_subscriptions;
create policy "own read" on public.recipe_push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own delete" on public.recipe_push_subscriptions;
create policy "own delete" on public.recipe_push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- Pas d'insertion directe : un même navigateur peut changer de compte, et l'endpoint est unique. L'abonnement passe
-- par cette fonction, qui le rattache à l'utilisateur connecté (reprise d'un endpoint précédemment lié à un autre compte).
revoke all on public.recipe_push_subscriptions from anon, authenticated;
grant select, delete on public.recipe_push_subscriptions to authenticated;
grant all on public.recipe_push_subscriptions to service_role;

create or replace function public.recipe_push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non connecté' using errcode = '42501'; end if;
  insert into recipe_push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- ---------------------------------------------------------------- notifications : boîte d'envoi
-- Remplie par des triggers, vidée par l'edge function recipe-notify (service_role). Aucun accès client.
create table if not exists public.recipe_notifications_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('import_termine','recette_ajoutee','invitation')),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0,                -- tentatives d'envoi (5 au plus)
  claimed_at timestamptz,                         -- réservation par une exécution de recipe-notify
  last_error text
);
create index if not exists recipe_notifications_outbox_pending_idx on public.recipe_notifications_outbox (created_at) where sent_at is null;
create index if not exists recipe_notifications_outbox_user_idx on public.recipe_notifications_outbox (user_id);

alter table public.recipe_notifications_outbox enable row level security;   -- aucune policy : refus pour tout client
revoke all on public.recipe_notifications_outbox from anon, authenticated;
grant all on public.recipe_notifications_outbox to service_role;

-- Réserve jusqu'à p_limit notifications à envoyer (ni envoyées, ni réservées depuis moins de 2 minutes, moins de
-- 5 tentatives, de moins de 24 h) ; verrouillage SKIP LOCKED pour que deux exécutions ne s'envoient pas le même message.
create or replace function public.recipe_outbox_claim(p_limit int default 50)
returns setof public.recipe_notifications_outbox
language sql security definer set search_path = public as $$
  update recipe_notifications_outbox o
     set attempts = o.attempts + 1, claimed_at = now()
   where o.id in (
     select id from recipe_notifications_outbox
      where sent_at is null and attempts < 5 and created_at > now() - interval '24 hours'
        and (claimed_at is null or claimed_at < now() - interval '2 minutes')
      order by id limit greatest(1, least(p_limit, 200)) for update skip locked)
  returning o.*
$$;

-- Nettoyage : notifications envoyées depuis plus de 14 jours, ou abandonnées depuis plus de 7 jours.
create or replace function public.recipe_outbox_purge() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with d as (delete from recipe_notifications_outbox
              where (sent_at is not null and sent_at < now() - interval '14 days') or created_at < now() - interval '7 days'
              returning 1)
  select count(*) into n from d;
  return n;
end $$;

revoke execute on function public.recipe_outbox_claim(int), public.recipe_outbox_purge() from anon, authenticated, public;
grant execute on function public.recipe_outbox_claim(int), public.recipe_outbox_purge() to service_role;

-- ---------------------------------------------------------------- notifications : déclencheurs
-- 1. Nouvelle recette ajoutée par un membre : les autres membres du carnet sont notifiés.
create or replace function public.recipe_notify_new_recipe() returns trigger
language plpgsql security definer set search_path = public as $$
declare bname text;
begin
  if new.created_by is null or new.deleted_at is not null or new.archived_at is not null then return null; end if;
  select left(name, 80) into bname from recipe_books where id = new.book_id;
  insert into recipe_notifications_outbox (user_id, kind, payload)
  select m.user_id, 'recette_ajoutee',
         jsonb_build_object('book_id', new.book_id, 'book_name', bname, 'recipe_id', new.id, 'title', left(new.title, 120))
    from recipe_book_members m
   where m.book_id = new.book_id and m.user_id <> new.created_by;
  return null;
end $$;
revoke execute on function public.recipe_notify_new_recipe() from anon, authenticated, public;

drop trigger if exists recipe_notify_new_recipe on public.recipes;
create trigger recipe_notify_new_recipe after insert on public.recipes
  for each row execute function public.recipe_notify_new_recipe();

-- 2. Invitation à un carnet pour un compte existant (invitation en attente ; pas pour un nouveau compte, déjà ajouté).
create or replace function public.recipe_notify_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid; bname text;
begin
  if new.accepted_at is not null then return null; end if;
  if tg_op = 'UPDATE' and old.accepted_at is null then return null; end if;   -- simple changement de rôle : pas de relance
  select id into uid from auth.users where lower(email) = new.email limit 1;
  if uid is null or exists (select 1 from recipe_book_members where book_id = new.book_id and user_id = uid) then return null; end if;
  select left(name, 80) into bname from recipe_books where id = new.book_id;
  insert into recipe_notifications_outbox (user_id, kind, payload)
  values (uid, 'invitation', jsonb_build_object('book_id', new.book_id, 'book_name', bname, 'invite_id', new.id));
  return null;
end $$;
revoke execute on function public.recipe_notify_invite() from anon, authenticated, public;

drop trigger if exists recipe_notify_invite on public.recipe_book_invites;
create trigger recipe_notify_invite after insert or update on public.recipe_book_invites
  for each row execute function public.recipe_notify_invite();

-- 3. Fin d'import (statut -> termine ou a_relire) : l'auteur de l'import est notifié, une seule fois.
create or replace function public.recipe_notify_import() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('termine','a_relire') and old.status is distinct from new.status
     and old.status not in ('termine','a_relire') then
    insert into recipe_notifications_outbox (user_id, kind, payload)
    values (new.created_by, 'import_termine',
            jsonb_build_object('book_id', new.book_id, 'import_id', new.id, 'recipe_id', new.recipe_id, 'status', new.status));
  end if;
  return null;
end $$;
revoke execute on function public.recipe_notify_import() from anon, authenticated, public;

-- recipe_imports est créée par recettes-phase2.sql : déclencheur créé seulement si la table existe.
do $$
begin
  if to_regclass('public.recipe_imports') is not null then
    drop trigger if exists recipe_notify_import on public.recipe_imports;
    create trigger recipe_notify_import after update of status on public.recipe_imports
      for each row execute function public.recipe_notify_import();
  else
    raise notice 'recipe_imports absente : déclencheur de fin d''import non créé (rejouer ce fichier après recettes-phase2.sql)';
  end if;
end $$;

-- ---------------------------------------------------------------- temps réel
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['recipe_shopping_items','recipe_meal_plan'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------- droits d'exécution
revoke execute on function public.recipe_plan_copy_rhythm(uuid, date, date),
  public.recipe_shopping_add_recipe(uuid, uuid, int), public.recipe_shopping_add_plan(uuid, date, date),
  public.recipe_push_subscribe(text, text, text), public.recipe_scale_qty(numeric, text, numeric),
  public.recipe_unit_family(text), public.recipe_unit_base(numeric, text), public.recipe_shopping_is_excluded(text, text[])
  from anon, public;
grant execute on function public.recipe_plan_copy_rhythm(uuid, date, date),
  public.recipe_shopping_add_recipe(uuid, uuid, int), public.recipe_shopping_add_plan(uuid, date, date),
  public.recipe_push_subscribe(text, text, text) to authenticated;
-- Les fonctions d'arrondi et d'unités sont des utilitaires internes : elles restent appelables par les fonctions
-- ci-dessus (security definer) sans être exposées à l'API (grant explicite à authenticated aussi, utile au front
-- pour afficher les mêmes arrondis ; aucune donnée lue).
grant execute on function public.recipe_scale_qty(numeric, text, numeric) to authenticated;
