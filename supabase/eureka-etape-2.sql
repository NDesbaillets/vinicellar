-- Eurêka · ajout rapide. À relire puis à appliquer après eureka.sql.
begin;

alter table public.sorties_inbox
  add column tentative uuid,
  add column reprise_apres timestamptz,
  add column alerte_budget boolean not null default false;

create table public.sorties_photos (
  id uuid primary key default gen_random_uuid(),
  idee_id uuid not null references public.sorties_idees on delete cascade,
  chemin text not null unique,
  position smallint not null check (position between 1 and 5),
  unique (idee_id, position)
);
alter table public.sorties_photos enable row level security;
revoke all on public.sorties_photos from public, anon, authenticated;
grant select on public.sorties_photos to authenticated;
grant all on public.sorties_photos to service_role;
create policy sorties_photos_lecture on public.sorties_photos for select to authenticated
  using (exists (select 1 from public.sorties_idees i where i.id = sorties_photos.idee_id));

-- Le client consulte ses propres imports. La création coordonnée avec la fiche
-- et les transitions d'état sont réservées à la fonction Edge.
grant select (id, espace_id, user_id, statut, idee_id, erreur, alerte_budget)
  on public.sorties_inbox to authenticated;
create policy sorties_inbox_lecture_propre on public.sorties_inbox for select to authenticated
  using (user_id = (select auth.uid()) and public.sorties_is_member(espace_id));
create index sorties_inbox_idee_auteur_idx on public.sorties_inbox (idee_id, user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('eureka-photos', 'eureka-photos', false, 5000000, array['image/jpeg', 'image/png', 'image/webp']);

create policy sorties_photos_depot on storage.objects for insert to authenticated
  with check (
    bucket_id = 'eureka-photos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.sorties_is_editor(
      case when name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/'
        then split_part(name, '/', 1)::uuid end)
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[1-5]\.(jpg|png|webp)$'
  );

create policy sorties_photos_objets_lecture on storage.objects for select to authenticated
  using (
    bucket_id = 'eureka-photos'
    and exists (select 1 from public.sorties_photos p where p.chemin = objects.name)
  );

create table public.sorties_depenses_enrichissement (
  call_id bigint primary key,
  espace_id uuid not null references public.sorties_espaces on delete cascade,
  mois date not null,
  reserve_chf numeric(10,2) not null check (reserve_chf > 0 and reserve_chf <> 'NaN'::numeric)
);
alter table public.sorties_depenses_enrichissement enable row level security;
revoke all on public.sorties_depenses_enrichissement from public, anon, authenticated;
grant all on public.sorties_depenses_enrichissement to service_role;
create index sorties_depenses_mois_idx on public.sorties_depenses_enrichissement (espace_id, mois);

create function public.sorties_creer_import(
  p_id uuid, p_espace uuid, p_user uuid, p_type text, p_contenu text, p_photos text[]
) returns uuid
language plpgsql set search_path = '' as $$
declare
  fiche uuid;
  photo text;
  rang integer := 0;
  source_lien boolean;
begin
  perform 1 from public.sorties_espace_membres
  where espace_id = p_espace and user_id = p_user and role in ('owner', 'membre') for share;
  if not found then raise exception 'Espace inaccessible' using errcode = '42501'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 1));
  select idee_id into fiche from public.sorties_inbox where id = p_id and espace_id = p_espace and user_id = p_user;
  if found then return fiche; end if;

  if p_type not in ('lien', 'texte', 'photo') or coalesce(cardinality(p_photos), 0) > 5
    or coalesce(length(p_contenu), 0) > 8000
    or (p_type = 'photo' and coalesce(cardinality(p_photos), 0) = 0)
    or (p_type <> 'photo' and nullif(btrim(p_contenu), '') is null) then
    raise exception 'Import invalide' using errcode = '22023';
  end if;

  foreach photo in array coalesce(p_photos, array[]::text[]) loop
    rang := rang + 1;
    if photo is null or photo !~ ('^' || p_espace || '/' || p_user || '/' || p_id || '/' || rang || '\.(jpg|png|webp)$')
      or not exists (select 1 from storage.objects where bucket_id = 'eureka-photos' and name = photo) then
      raise exception 'Photo invalide' using errcode = '22023';
    end if;
  end loop;

  source_lien := p_type = 'lien';
  insert into public.sorties_idees (espace_id, titre, notes, ajoutee_par, source_type, source_url, image_path, a_verifier)
  values (
    p_espace,
    case when source_lien then 'Lien à compléter'
         when nullif(btrim(p_contenu), '') is not null then left(split_part(btrim(p_contenu), chr(10), 1), 110)
         else 'Photo à compléter' end,
    case when not source_lien then p_contenu end,
    p_user,
    case when source_lien and p_contenu ~ '^https://(www\.)?instagram\.com/reels?/' then 'reel' else p_type end,
    case when source_lien then p_contenu end,
    p_photos[1],
    '{"import":"Fiche à compléter"}'
  ) returning id into fiche;
  insert into public.sorties_inbox (id, espace_id, user_id, type, contenu, image_path, idee_id)
    values (p_id, p_espace, p_user, p_type, p_contenu, p_photos[1], fiche);
  insert into public.sorties_photos (idee_id, chemin, position)
    select fiche, chemin, n from unnest(p_photos) with ordinality as photos(chemin, n);
  return fiche;
end;
$$;

create function public.sorties_reserver_enrichissement(
  p_inbox uuid, p_tentative uuid, p_kind text, p_chf numeric
) returns bigint
language plpgsql set search_path = '' as $$
declare
  import public.sorties_inbox%rowtype;
  plafond numeric;
  total numeric;
  mois_courant date := date_trunc('month', now() at time zone 'Europe/Zurich')::date;
  journal bigint;
begin
  if p_kind not in ('sorties-apify', 'sorties-claude')
    or p_chf is null or not (p_chf > 0 and p_chf < 1000000) then
    raise exception 'Réservation invalide' using errcode = '22023';
  end if;
  select * into import from public.sorties_inbox
    where id = p_inbox and tentative = p_tentative and statut = 'en_cours' for update;
  if not found then return null; end if;
  perform 1 from public.sorties_espace_membres where espace_id = import.espace_id
    and user_id = import.user_id and role in ('owner', 'membre') for share;
  if not found then return null; end if;
  select plafond_ia_mensuel_chf into plafond from public.sorties_espaces
    where id = import.espace_id for update;
  select coalesce(sum(reserve_chf), 0) into total from public.sorties_depenses_enrichissement
    where espace_id = import.espace_id and mois = mois_courant;
  if total + p_chf > plafond then
    update public.sorties_inbox set alerte_budget = true where id = p_inbox;
    return null;
  end if;
  insert into public.ai_calls (user_id, kind) values (import.user_id, p_kind) returning id into journal;
  insert into public.sorties_depenses_enrichissement (call_id, espace_id, mois, reserve_chf)
    values (journal, import.espace_id, mois_courant, p_chf);
  if total + p_chf >= plafond * 0.7 then
    update public.sorties_inbox set alerte_budget = true where id = p_inbox;
  end if;
  return journal;
end;
$$;

-- Verrouille le bail d'enrichissement avant de publier. Une ancienne exécution
-- expirée ne peut pas modifier la fiche ni clore la nouvelle tentative.
create function public.sorties_terminer_import(
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

revoke execute on function public.sorties_creer_import(uuid, uuid, uuid, text, text, text[]),
  public.sorties_reserver_enrichissement(uuid, uuid, text, numeric),
  public.sorties_terminer_import(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.sorties_creer_import(uuid, uuid, uuid, text, text, text[]),
  public.sorties_reserver_enrichissement(uuid, uuid, text, numeric),
  public.sorties_terminer_import(uuid, uuid, jsonb, text) to service_role;

commit;
