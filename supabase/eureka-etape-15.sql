-- Destination et trajets retenus pour chaque occurrence. Les politiques RLS restent en place.
begin;

alter table public.sorties_options add column if not exists trajet_google jsonb;
alter table public.sorties_occurrences
  add column if not exists option_id uuid references public.sorties_options(id) on delete set null,
  add column if not exists destination text;
grant select (trajet_google) on public.sorties_options to authenticated;
grant select (option_id, destination), insert (option_id) on public.sorties_occurrences to authenticated;

create or replace function public.sorties_verifier_creneau()
returns trigger language plpgsql set search_path = '' as $$
declare
  espace uuid;
  parametres jsonb;
  creneau tstzrange;
  depart uuid;
  trajet jsonb;
begin
  if new.statut <> 'prevue' then return new; end if;
  if tg_op = 'UPDATE' and old.statut = 'prevue'
      and old.date_cible is not distinct from new.date_cible and old.idee_id = new.idee_id then
    return new;
  end if;

  select i.espace_id, i.parametres_creneau, i.lieu_depart_id into espace, parametres, depart
  from public.sorties_idees i where i.id = new.idee_id;
  if new.option_id is not null then
    select o.trajet_google, o.nom into trajet, new.destination
    from public.sorties_options o
    where o.id = new.option_id and o.idee_id = new.idee_id
      and o.trajet_google->>'depart' = depart::text and o.trajet_google->>'lieu' = o.lieu;
    if trajet is null
      or coalesce(trajet->>'aller_minutes', '') !~ '^[0-9]{1,4}$'
      or coalesce(trajet->>'retour_minutes', '') !~ '^[0-9]{1,4}$' then
      raise exception 'Le trajet pour cette destination doit être calculé.' using errcode = '23514';
    end if;
    parametres := parametres || jsonb_build_object('aller_minutes', trajet->'aller_minutes',
      'retour_minutes', trajet->'retour_minutes');
  end if;
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


-- Stations déjà proposées sur la fiche « Journée de ski depuis Nyon ».
insert into public.sorties_options (idee_id, nom, lieu)
select i.id, d.nom, d.lieu from public.sorties_idees i
cross join (values
  ('Flaine', 'Flaine Forum, Arâches-la-Frasse, France'),
  ('Morzine', 'Téléphérique du Pléney, Morzine, France'),
  ('Les Carroz', 'Télécabine de la Kédeuze, Les Carroz, France'),
  ('Megève', 'Télécabine du Chamois, Megève, France'),
  ('Portes du Soleil · Les Gets', 'Télécabine des Chavannes, Les Gets, France'),
  ('Villars', 'Télécabine du Roc d’Orsay, Villars-sur-Ollon, Suisse'),
  ('Les Diablerets', 'Télécabine Diablerets Express, Les Diablerets, Suisse'),
  ('Verbier', 'Télécabine de Médran, Verbier, Suisse')
) d(nom, lieu)
where i.espace_id = '51226a02-3bd2-4cf9-8ac4-22add26f1269'
  and i.titre = 'Journée de ski depuis Nyon' and i.fusionnee_dans is null
  and not exists (select 1 from public.sorties_options o where o.idee_id = i.id and o.nom = d.nom);

commit;
