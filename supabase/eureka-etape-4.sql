-- Eurêka · miroir iCloud et créneaux provisoires. Après eureka-etape-3.sql.
begin;

create table public.sorties_liaison_icloud (
  singleton boolean primary key default true check (singleton),
  espace_id uuid not null,
  user_id uuid not null,
  bail uuid,
  bail_jusqua timestamptz,
  foreign key (espace_id, user_id) references public.sorties_espace_membres on delete cascade
);
alter table public.sorties_liaison_icloud enable row level security;
revoke all on public.sorties_liaison_icloud from public, anon, authenticated;
grant all on public.sorties_liaison_icloud to service_role;

alter table public.sorties_calendriers
  add column professionnel boolean not null default false,
  add column disponible boolean not null default true,
  add column modifiable boolean not null default false,
  add column revision integer not null default 0,
  add column synchro_le timestamptz,
  add constraint sorties_calendriers_professionnels check (not professionnel or mode = 'occupe');

alter table public.sorties_reglages
  add column heure_creneau time check (heure_creneau < '24:00'::time),
  add column duree_creneau_minutes smallint check (duree_creneau_minutes between 30 and 480);

create index sorties_occupation_plages_idx on public.sorties_occupation (calendrier_id, debut, fin);

create function public.sorties_agenda_actif(p_espace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.sorties_is_editor(p_espace) and exists (
    select 1 from public.sorties_liaison_icloud l where l.espace_id = p_espace and l.user_id = (select auth.uid())
  );
$$;

create policy sorties_calendriers_perso on public.sorties_calendriers for select to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.sorties_espace_membres m
    where m.user_id = (select auth.uid()) and public.sorties_agenda_actif(m.espace_id)
  ));
grant select (id, user_id, nom, actif, mode, ecriture, professionnel, disponible, modifiable, synchro_le)
  on public.sorties_calendriers to authenticated;
create policy sorties_occupation_perso on public.sorties_occupation for select to authenticated
  using (exists (select 1 from public.sorties_calendriers c where c.id = calendrier_id and c.actif and c.disponible));
grant select (calendrier_id, debut, fin, titre) on public.sorties_occupation to authenticated;

-- Retire tout titre déjà conservé, dans la même transaction que le changement
-- de préférence. Une synchronisation ayant lu l'ancienne version est rejetée.
create function public.sorties_configurer_calendrier(
  p_espace uuid, p_id uuid, p_actif boolean, p_titres boolean, p_professionnel boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.sorties_agenda_actif(p_espace) then
    raise exception 'Agenda inaccessible' using errcode = '42501';
  end if;
  if p_actif is null or p_titres is null or p_professionnel is null
    or (p_titres and (not p_actif or p_professionnel)) then
    raise exception 'Préférences invalides' using errcode = '22023';
  end if;
  perform 1 from public.sorties_liaison_icloud where espace_id = p_espace and user_id = (select auth.uid()) for update;
  if p_actif and (select count(*) from public.sorties_calendriers
    where user_id = (select auth.uid()) and actif and disponible and id <> p_id) >= 12 then
    raise exception 'Douze calendriers actifs au maximum' using errcode = '22023';
  end if;
  update public.sorties_calendriers set actif = p_actif, professionnel = p_professionnel,
    mode = case when p_titres then 'titres' else 'occupe' end,
    ecriture = ecriture and p_actif and not p_professionnel,
    revision = revision + 1, synchro_le = null
    where id = p_id and user_id = (select auth.uid()) and (disponible or not p_actif);
  if not found then raise exception 'Calendrier inaccessible' using errcode = '42501'; end if;
  if not p_actif then
    delete from public.sorties_occupation where calendrier_id = p_id;
  elsif not p_titres then
    update public.sorties_occupation set titre = null where calendrier_id = p_id and titre is not null;
  end if;
  if not p_actif or p_professionnel then
    update public.sorties_reglages set calendrier_ecriture_id = null
    where espace_id = p_espace and user_id = (select auth.uid()) and calendrier_ecriture_id = p_id;
  end if;
end;
$$;

create function public.sorties_configurer_creneau(
  p_espace uuid, p_calendrier uuid, p_heure time default null, p_duree smallint default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if not public.sorties_agenda_actif(p_espace) then
    raise exception 'Agenda inaccessible' using errcode = '42501';
  end if;
  -- Sérialise les changements de destination et les suppressions de consentement.
  perform 1 from public.sorties_liaison_icloud where espace_id = p_espace and user_id = v_user for update;
  if p_calendrier is not null then
    if p_heure is null or p_heure >= '24:00'::time or p_duree is null or p_duree not between 30 and 480
      or not exists (select 1 from public.sorties_calendriers c where c.id = p_calendrier and c.user_id = v_user
        and c.nom = 'Eurêka' and c.actif and c.disponible and c.modifiable and not c.professionnel) then
      raise exception 'Choisissez un calendrier Eurêka actif et modifiable, une heure et une durée' using errcode = '22023';
    end if;
  end if;
  update public.sorties_calendriers set ecriture = false where user_id = v_user and ecriture;
  if p_calendrier is not null then
    update public.sorties_calendriers set ecriture = true where id = p_calendrier and user_id = v_user
      and nom = 'Eurêka' and actif and disponible and modifiable and not professionnel;
    if not found then raise exception 'Calendrier indisponible' using errcode = '22023'; end if;
  end if;
  insert into public.sorties_reglages (espace_id, user_id, calendrier_ecriture_id, heure_creneau, duree_creneau_minutes)
    values (p_espace, v_user, p_calendrier, case when p_calendrier is not null then p_heure end,
      case when p_calendrier is not null then p_duree end)
  on conflict (espace_id, user_id) do update set
    calendrier_ecriture_id = excluded.calendrier_ecriture_id, heure_creneau = excluded.heure_creneau,
    duree_creneau_minutes = excluded.duree_creneau_minutes;
end;
$$;

create function public.sorties_reconcilier_calendriers(p_user uuid, p_liste jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(p_liste) is distinct from 'array' or jsonb_array_length(p_liste) > 100 then
    raise exception 'Découverte invalide' using errcode = '22023';
  end if;
  update public.sorties_calendriers c set disponible = false, ecriture = false,
    actif = false, mode = 'occupe', revision = c.revision + 1, synchro_le = null
  where c.user_id = p_user and c.disponible and not exists (
    select 1 from jsonb_to_recordset(p_liste) as x(href text) where x.href = c.href
  );
  insert into public.sorties_calendriers (user_id, nom, href, modifiable)
    select p_user, x.nom, x.href, x.modifiable
    from jsonb_to_recordset(p_liste) as x(nom text, href text, modifiable boolean)
  on conflict (user_id, href) do update set
    nom = excluded.nom, disponible = true, modifiable = excluded.modifiable,
    ecriture = sorties_calendriers.ecriture and excluded.nom = 'Eurêka' and excluded.modifiable;
  delete from public.sorties_occupation o using public.sorties_calendriers c
    where o.calendrier_id = c.id and c.user_id = p_user and not c.disponible;
  update public.sorties_reglages r set calendrier_ecriture_id = null
    from public.sorties_calendriers c where c.id = r.calendrier_ecriture_id and c.user_id = p_user and not c.ecriture;
end;
$$;

create function public.sorties_remplacer_occupation(
  p_id uuid, p_revision integer, p_commence timestamptz, p_blocs jsonb
) returns boolean language plpgsql set search_path = '' as $$
declare c public.sorties_calendriers%rowtype;
begin
  select * into c from public.sorties_calendriers where id = p_id and revision = p_revision
    and actif and disponible and (synchro_le is null or synchro_le < p_commence) for update;
  if not found then return false; end if;
  if jsonb_typeof(p_blocs) is distinct from 'array' or jsonb_array_length(p_blocs) > 3000 then
    raise exception 'Miroir trop volumineux' using errcode = '22023';
  end if;
  delete from public.sorties_occupation where calendrier_id = c.id;
  insert into public.sorties_occupation (calendrier_id, debut, fin, titre, uid_externe)
  select c.id, x.debut, x.fin, case when c.mode = 'titres' and not c.professionnel then left(x.titre, 200) end, x.uid_externe
  from jsonb_to_recordset(p_blocs) as x(debut timestamptz, fin timestamptz, titre text, uid_externe text)
  on conflict (calendrier_id, uid_externe, debut) do nothing;
  update public.sorties_calendriers set synchro_le = p_commence where id = c.id;
  return true;
end;
$$;

create table public.sorties_creneaux_provisoires (
  id uuid primary key default gen_random_uuid(),
  rappel_id uuid unique references public.sorties_rappels on delete set null,
  espace_id uuid not null references public.sorties_espaces on delete cascade,
  calendrier_id uuid not null references public.sorties_calendriers on delete restrict,
  debut timestamptz not null,
  fin timestamptz not null check (fin > debut),
  statut text not null default 'prepare' check (statut in ('prepare', 'ecrit', 'retire', 'conflit')),
  etag text,
  cree_le timestamptz not null default now()
);
alter table public.sorties_creneaux_provisoires enable row level security;
revoke all on public.sorties_creneaux_provisoires from public, anon, authenticated;
grant all on public.sorties_creneaux_provisoires to service_role;
grant select (id, espace_id, debut, fin, statut) on public.sorties_creneaux_provisoires to authenticated;
create policy sorties_creneaux_perso on public.sorties_creneaux_provisoires for select to authenticated
  using (public.sorties_agenda_actif(espace_id) and exists (
    select 1 from public.sorties_calendriers c where c.id = calendrier_id and c.user_id = (select auth.uid())
  ));
create index sorties_creneaux_actifs_idx on public.sorties_creneaux_provisoires (espace_id, fin)
  where statut in ('prepare', 'ecrit');

create function public.sorties_creneau_candidats(p_espace uuid)
returns table (rappel_id uuid, date_debut date, date_limite date, calendrier_id uuid, heure time, duree smallint)
language sql stable set search_path = '' as $$
  select r.id, i.date_debut, i.date_limite_reservation, c.id, g.heure_creneau, g.duree_creneau_minutes
  from public.sorties_rappels r
  join public.sorties_liaison_icloud l using (espace_id, user_id)
  join public.sorties_espace_membres m using (espace_id, user_id)
  join public.sorties_idees i on r.idee_id = i.id and r.espace_id = i.espace_id
  join public.sorties_reglages g on g.espace_id = l.espace_id and g.user_id = l.user_id
  join public.sorties_calendriers c on c.id = g.calendrier_ecriture_id and c.user_id = l.user_id
  where r.espace_id = p_espace and r.type = 'echeance' and r.etape = 3 and r.reponse is null
    and r.cle = r.cycle || ':3' and m.role in ('membre', 'owner')
    and r.cycle = coalesce(i.date_limite_reservation, i.date_debut) - least(coalesce(i.preavis_semaines, 0), 5200) * 7
    and i.fusionnee_dans is null and i.statut in ('envie', 'preselection')
    and c.nom = 'Eurêka' and c.ecriture and c.actif and c.disponible and c.modifiable and not c.professionnel
    and g.heure_creneau is not null and g.duree_creneau_minutes is not null
    and not exists (select 1 from public.sorties_occurrences o where o.idee_id = i.id and o.statut = 'prevue')
    and not exists (select 1 from public.sorties_rappels x where x.idee_id = i.id and x.cycle = r.cycle
      and x.user_id = r.user_id and x.type = 'echeance' and x.reponse in ('reserve', 'archive'))
  order by i.urgence desc, r.prevu_le, r.id;
$$;

create function public.sorties_preparer_creneau(
  p_espace uuid, p_rappel uuid, p_calendrier uuid, p_debut timestamptz, p_fin timestamptz
) returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  perform 1 from public.sorties_liaison_icloud where espace_id = p_espace for update;
  if not exists (select 1 from public.sorties_creneau_candidats(p_espace) where rappel_id = p_rappel
    and calendrier_id = p_calendrier) or p_debut <= now() then return null; end if;
  if exists (select 1 from public.sorties_creneaux_provisoires
    where calendrier_id = p_calendrier and statut in ('prepare', 'ecrit') and debut < p_fin and fin > p_debut)
    or exists (
      select 1 from public.sorties_liaison_icloud l
      join public.sorties_calendriers c on c.user_id = l.user_id and c.actif and c.disponible
      join public.sorties_occupation o on o.calendrier_id = c.id
      where l.espace_id = p_espace and o.debut < p_fin and o.fin > p_debut
    ) then return null; end if;
  insert into public.sorties_creneaux_provisoires (espace_id, rappel_id, calendrier_id, debut, fin)
    values (p_espace, p_rappel, p_calendrier, p_debut, p_fin)
    on conflict (rappel_id) do nothing returning id into v_id;
  return v_id;
end;
$$;

create function public.sorties_journal_caldav(p_espace uuid, p_user uuid, p_bail uuid, p_action text) returns bigint
language plpgsql set search_path = '' as $$
declare v_id bigint;
begin
  if p_action is null or p_action not in ('decouverte', 'lecture', 'ecriture', 'retrait')
    or not exists (select 1 from public.sorties_liaison_icloud l
      join public.sorties_espace_membres m using (espace_id, user_id)
      where l.espace_id = p_espace and l.user_id = p_user and l.bail = p_bail and l.bail_jusqua > now()
        and m.role in ('owner','membre')) then
    return null;
  end if;
  -- CalDAV iCloud n'engendre aucun coût par appel. Ce plafond supplémentaire
  -- limite les requêtes journalisées par liaison et par mois civil suisse.
  perform pg_catalog.pg_advisory_xact_lock(48343, 4);
  if (select count(*) from public.ai_calls
    where user_id = p_user and kind like 'sorties-caldav-%'
      and created_at >= (date_trunc('month', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich')) >= 20000 then
    return null;
  end if;
  insert into public.ai_calls (user_id, kind) values (p_user, 'sorties-caldav-' || p_action) returning id into v_id;
  return v_id;
end;
$$;

create function public.sorties_cron_icloud() returns void language plpgsql set search_path = '' as $$
declare jeton text; adresse text;
begin
  select decrypted_secret into jeton from vault.decrypted_secrets where name = 'eureka_icloud_cron_secret' limit 1;
  select decrypted_secret into adresse from vault.decrypted_secrets where name = 'eureka_icloud_url' limit 1;
  if jeton is null or length(jeton) < 24 or adresse is null
    or adresse !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/sorties-calendrier$' then return; end if;
  if exists (select 1 from public.sorties_liaison_icloud l join public.sorties_espace_membres m using (espace_id, user_id)
    where m.role in ('membre','owner')) then
    perform net.http_post(url := adresse, headers := jsonb_build_object('x-icloud-cron', jeton),
      body := '{}'::jsonb, timeout_milliseconds := 5000);
  end if;
end;
$$;

revoke execute on function public.sorties_agenda_actif(uuid), public.sorties_configurer_calendrier(uuid, uuid, boolean, boolean, boolean),
  public.sorties_configurer_creneau(uuid, uuid, time, smallint), public.sorties_reconcilier_calendriers(uuid, jsonb),
  public.sorties_remplacer_occupation(uuid, integer, timestamptz, jsonb), public.sorties_creneau_candidats(uuid),
  public.sorties_preparer_creneau(uuid, uuid, uuid, timestamptz, timestamptz), public.sorties_journal_caldav(uuid, uuid, uuid, text),
  public.sorties_cron_icloud() from public, anon, authenticated;
grant execute on function public.sorties_agenda_actif(uuid), public.sorties_configurer_calendrier(uuid, uuid, boolean, boolean, boolean),
  public.sorties_configurer_creneau(uuid, uuid, time, smallint) to authenticated;
grant execute on function public.sorties_reconcilier_calendriers(uuid, jsonb),
  public.sorties_remplacer_occupation(uuid, integer, timestamptz, jsonb), public.sorties_creneau_candidats(uuid),
  public.sorties_preparer_creneau(uuid, uuid, uuid, timestamptz, timestamptz), public.sorties_journal_caldav(uuid, uuid, uuid, text) to service_role;

select cron.schedule('eureka-icloud', '*/15 * * * *', 'select public.sorties_cron_icloud()');
commit;
