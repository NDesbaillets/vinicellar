-- À appliquer après eureka-etape-7.sql. Les politiques RLS restent inchangées.
begin;

alter table public.sorties_occurrences
  add column if not exists heure_activite_planifiee time;

grant insert (heure_activite_planifiee) on public.sorties_occurrences to authenticated;

create or replace function public.sorties_verifier_creneau()
returns trigger language plpgsql set search_path = '' as $$
declare
  espace uuid;
  parametres jsonb;
  creneau tstzrange;
begin
  if new.statut <> 'prevue' then return new; end if;
  if tg_op = 'UPDATE' and old.statut = 'prevue'
      and old.date_cible is not distinct from new.date_cible and old.idee_id = new.idee_id then
    return new;
  end if;

  select i.espace_id, i.parametres_creneau into espace, parametres
  from public.sorties_idees i where i.id = new.idee_id;
  if parametres->'demi_journee_flexible' = 'true'::jsonb then
    if new.heure_activite_planifiee is null
        or new.heure_activite_planifiee not between time '08:00' and time '16:00'
        or mod(extract(epoch from new.heure_activite_planifiee), 1800) <> 0
        or parametres->'weekend' is distinct from 'false'::jsonb
        or parametres->'duree_minutes' is distinct from '240'::jsonb then
      raise exception 'Choisis une heure de début valide pour la demi-journée flexible.' using errcode = '23514';
    end if;
    parametres := jsonb_set(parametres, '{heure_activite}',
      to_jsonb(to_char(new.date_cible + new.heure_activite_planifiee, 'HH24:MI')));
  elsif tg_op = 'INSERT' and new.heure_activite_planifiee is not null then
    raise exception 'Les horaires fixes sont définis sur la fiche.' using errcode = '23514';
  else
    new.heure_activite_planifiee := null;
  end if;
  creneau := public.sorties_calculer_creneau(parametres, new.date_cible);
  if creneau is null or lower(creneau) <= now() then
    raise exception 'Le créneau de cette activité doit être confirmé et à venir.' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(espace::text, 0));
  if exists (
    select 1 from public.sorties_occurrences o join public.sorties_idees i on i.id = o.idee_id
    where i.espace_id = espace and o.statut = 'prevue' and o.id <> new.id and o.date_cible is not null
      and creneau && tstzrange(
        coalesce(o.debut_planifie, o.date_cible::timestamp at time zone 'Europe/Zurich'),
        coalesce(o.fin_planifie, (o.date_cible + 1)::timestamp at time zone 'Europe/Zurich'), '[)')
  ) then
    raise exception 'Ce créneau chevauche une sortie déjà planifiée.' using errcode = '23P01';
  end if;
  new.debut_planifie := lower(creneau);
  new.fin_planifie := upper(creneau);
  return new;
end;
$$;

commit;
