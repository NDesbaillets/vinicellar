-- À appliquer après les étapes précédentes. Les anciennes occurrences restent lisibles.
begin;

alter table public.sorties_idees
  add column if not exists parametres_creneau jsonb,
  add column if not exists proposition_creneau jsonb;
alter table public.sorties_occurrences
  add column if not exists debut_planifie timestamptz,
  add column if not exists fin_planifie timestamptz;

grant select (parametres_creneau, proposition_creneau), insert (parametres_creneau),
  update (parametres_creneau) on public.sorties_idees to authenticated;

create or replace function public.sorties_calculer_creneau(p jsonb, jour date)
returns tstzrange language plpgsql stable set search_path = '' as $$
declare
  debut timestamptz;
  arrivee timestamptz;
  retour timestamptz;
  aller interval;
  trajet_retour interval;
  duree interval;
  multi boolean;
begin
  if p is null or jour is null or pg_catalog.jsonb_typeof(p->'jours') is distinct from 'array'
     or not (p->'jours' @> pg_catalog.to_jsonb(array[extract(isodow from jour)::int]))
     or coalesce(p->>'heure_activite', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(p->>'duree_minutes', '') !~ '^[0-9]{1,5}$'
     or coalesce(p->>'aller_minutes', '') !~ '^[0-9]{1,4}$'
     or coalesce(p->>'retour_minutes', '') !~ '^[0-9]{1,4}$' then
    return null;
  end if;
  if (p->>'duree_minutes')::int not between 1 and 10080
     or (p->>'aller_minutes')::int > 1440 or (p->>'retour_minutes')::int > 1440 then
    return null;
  end if;
  duree := pg_catalog.make_interval(mins => (p->>'duree_minutes')::int);
  aller := pg_catalog.make_interval(mins => (p->>'aller_minutes')::int);
  trajet_retour := pg_catalog.make_interval(mins => (p->>'retour_minutes')::int);
  multi := p->'weekend' = 'true'::jsonb;
  arrivee := (jour + (p->>'heure_activite')::time) at time zone 'Europe/Zurich';
  if (arrivee at time zone 'Europe/Zurich')::time <> (p->>'heure_activite')::time then
    return null;
  end if;
  debut := arrivee - aller;
  retour := arrivee + duree;
  if multi then
    if extract(isodow from jour) <> 6 or coalesce(p->>'retour_decalage', '') !~ '^[0-6]$'
       or coalesce(p->>'heure_retour', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return null;
    end if;
    retour := (jour + (p->>'retour_decalage')::int + (p->>'heure_retour')::time) at time zone 'Europe/Zurich';
    if (retour at time zone 'Europe/Zurich')::time <> (p->>'heure_retour')::time then return null; end if;
    if p->'vendredi_soir' = 'true'::jsonb then
      if coalesce(p->>'heure_vendredi', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
      debut := (jour - 1 + (p->>'heure_vendredi')::time) at time zone 'Europe/Zurich';
    end if;
  end if;
  if debut + aller > arrivee or retour < arrivee + duree then return null; end if;
  return tstzrange(debut, retour + trajet_retour, '[)');
end;
$$;

create or replace function public.sorties_parametres_creneau_valides(p jsonb)
returns boolean language sql stable set search_path = '' as $$
  select case when jsonb_typeof(p) is distinct from 'object'
      or jsonb_typeof(p->'weekend') is distinct from 'boolean'
      or jsonb_typeof(p->'jours') is distinct from 'array' then false
    else jsonb_array_length(p->'jours') between 1 and 7
      and p->'jours' <@ '[1,2,3,4,5,6,7]'::jsonb
      and (p->'weekend' = 'false'::jsonb or
        (p->'jours' = '[6]'::jsonb and jsonb_typeof(p->'vendredi_soir') = 'boolean'))
      and exists (
        select 1 from generate_series(0, 6) as j(decalage)
        where public.sorties_calculer_creneau(p, date '2024-01-08' + j.decalage) is not null
      )
  end;
$$;

alter table public.sorties_idees drop constraint if exists sorties_idees_parametres_creneau_valides;
alter table public.sorties_idees add constraint sorties_idees_parametres_creneau_valides
  check (parametres_creneau is null or public.sorties_parametres_creneau_valides(parametres_creneau) is true);

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

drop trigger if exists sorties_occurrences_verifier_creneau on public.sorties_occurrences;
create trigger sorties_occurrences_verifier_creneau
  before insert or update of date_cible, statut, idee_id on public.sorties_occurrences
  for each row execute function public.sorties_verifier_creneau();

create or replace function public.sorties_terminer_import(
  p_inbox uuid, p_tentative uuid, p_resultat jsonb, p_erreur text
) returns void
language plpgsql set search_path = '' as $$
declare
  import public.sorties_inbox%rowtype;
  information text;
begin
  select * into import from public.sorties_inbox where id = p_inbox
    and tentative = p_tentative and statut = 'en_cours' for update;
  if not found then return; end if;

  if p_resultat is not null then
    update public.sorties_idees i set
      titre = coalesce(p_resultat->>'titre', i.titre),
      accroche = p_resultat->>'accroche', description = p_resultat->>'description',
      categorie = p_resultat->>'categorie', format = p_resultat->>'format',
      type_lieu = case when p_resultat->>'adresse' is not null or p_resultat->>'ville' is not null
        then 'lieu' else i.type_lieu end,
      adresse = p_resultat->>'adresse', ville = p_resultat->>'ville',
      site_reservation = p_resultat->>'site_reservation', telephone = p_resultat->>'telephone',
      budget_min = (p_resultat->>'budget_min')::numeric, budget_max = (p_resultat->>'budget_max')::numeric,
      date_debut = (p_resultat->>'date_debut')::date, date_fin = (p_resultat->>'date_fin')::date,
      date_limite_reservation = (p_resultat->>'date_limite_reservation')::date,
      urgence = coalesce((p_resultat->>'urgence')::smallint, i.urgence),
      preavis_semaines = (p_resultat->>'preavis_semaines')::integer,
      image_path = coalesce(i.image_path, p_resultat->>'image_url'),
      proposition_creneau = nullif(p_resultat->'proposition_creneau', 'null'::jsonb),
      a_verifier = coalesce(p_resultat->'a_verifier', '{}'::jsonb)
    where i.id = import.idee_id and i.espace_id = import.espace_id
      and i.a_verifier ? 'import' and i.maj_le = i.cree_le;
    if not found then
      information := 'La fiche a été modifiée pendant l’enrichissement. Vos modifications ont été conservées.';
    end if;
  end if;
  update public.sorties_inbox set statut = case when p_erreur is null then 'traite' else 'echec' end,
    erreur = coalesce(p_erreur, information), tentative = null, reprise_apres = null where id = p_inbox;
end;
$$;

commit;
