-- Eurêka · rappels, consentement et file de livraison.
begin;

-- Le propriétaire configure explicitement le destinataire principal de chaque
-- espace. Les rôles d'espace et les prénoms ne suffisent pas à le déduire.
create table public.sorties_destinataires_rappel (
  espace_id uuid primary key,
  user_id uuid not null,
  foreign key (espace_id, user_id) references public.sorties_espace_membres on delete cascade
);
alter table public.sorties_destinataires_rappel enable row level security;
revoke all on public.sorties_destinataires_rappel from public, anon, authenticated;
grant all on public.sorties_destinataires_rappel to service_role;

alter table public.sorties_rappels
  drop constraint sorties_rappels_reponse_check,
  add constraint sorties_rappels_reponse_check
    check (reponse in ('reserve', 'reporte', 'archive', 'disponible', 'actuel', 'baisse')),
  add column cycle date,
  add column cle text,
  add column motif text,
  add column confirme_actualite boolean not null default false,
  add constraint sorties_rappels_cle unique (idee_id, user_id, type, cle);

create index sorties_rappels_historique_idx
  on public.sorties_rappels (idee_id, user_id, type, prevu_le desc, id);
create index sorties_rappels_personnels_idx on public.sorties_rappels (user_id, espace_id, prevu_le desc);
alter table public.sorties_notifications_outbox
  add column rappel_id uuid references public.sorties_rappels on delete cascade,
  add column jour_local date,
  add column canal text check (canal in ('push', 'email')),
  add column annule_le timestamptz,
  add constraint sorties_outbox_unique_rappel unique (rappel_id, user_id, kind);
create index sorties_outbox_plafond_idx on public.sorties_notifications_outbox (user_id, jour_local)
  where annule_le is null;

grant select on public.sorties_rappels, public.sorties_reglages, public.sorties_suivis to authenticated;
create policy sorties_rappels_lecture on public.sorties_rappels for select to authenticated
  using (user_id = (select auth.uid()) and public.sorties_is_member(espace_id));
create policy sorties_reglages_lecture on public.sorties_reglages for select to authenticated
  using (user_id = (select auth.uid()) and public.sorties_is_member(espace_id));

create function public.sorties_gere_suivis(p_espace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.sorties_is_editor(p_espace) and exists (
    select 1 from public.sorties_destinataires_rappel d
    where d.espace_id = p_espace and d.user_id = (select auth.uid())
  );
$$;

create policy sorties_suivis_lecture on public.sorties_suivis for select to authenticated
  using (public.sorties_is_member(espace_id)
    and (demandeuse = (select auth.uid()) or public.sorties_gere_suivis(espace_id)));

create function public.sorties_suivi_role(p_espace uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when public.sorties_gere_suivis(p_espace) then 'principal'
    when public.sorties_is_member(p_espace) and exists (
      select 1 from public.sorties_destinataires_rappel d
      join public.sorties_espace_membres m using (espace_id, user_id)
      where d.espace_id = p_espace and m.role in ('owner', 'membre')
    ) then 'demande' end;
$$;

create function public.sorties_demander_suivi(p_idee uuid, p_activer boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_espace uuid;
  v_user uuid := auth.uid();
begin
  select espace_id into v_espace from public.sorties_idees where id = p_idee;
  if p_activer is null or public.sorties_suivi_role(v_espace) is distinct from 'demande' then
    raise exception 'Suivi indisponible' using errcode = '42501';
  end if;
  if p_activer then
    insert into public.sorties_suivis (espace_id, idee_id, demandeuse)
    values (v_espace, p_idee, v_user) on conflict do nothing;
  else
    delete from public.sorties_suivis where idee_id = p_idee and demandeuse = v_user;
  end if;
end;
$$;

create function public.sorties_decider_suivi(p_idee uuid, p_demandeuse uuid, p_accepter boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_espace uuid;
begin
  select espace_id into v_espace from public.sorties_idees where id = p_idee;
  if not public.sorties_gere_suivis(v_espace) or p_accepter is null then
    raise exception 'Décision inaccessible' using errcode = '42501';
  end if;
  update public.sorties_suivis set statut = case when p_accepter then 'accepte' else 'refuse' end,
    decide_le = now()
  where idee_id = p_idee and demandeuse = p_demandeuse
    and statut in ('en_attente', 'accepte');
  if not found then raise exception 'Demande introuvable' using errcode = '22023'; end if;
end;
$$;

create function public.sorties_enregistrer_reglages(
  p_espace uuid, p_max integer, p_semaine time, p_weekend time, p_ton text, p_poids jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.sorties_is_member(p_espace) then
    raise exception 'Espace inaccessible' using errcode = '42501';
  end if;
  if p_max is null or p_max not between 0 and 2 or p_semaine is null or p_weekend is null
    or p_semaine >= '24:00'::time or p_weekend >= '24:00'::time
    or p_ton is null or p_ton not in ('direct_humour', 'neutre')
    or jsonb_typeof(p_poids) is distinct from 'object' then
    raise exception 'Réglages invalides' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_poids) item
    where item.key not in ('envie', 'urgence', 'saison', 'ajouts', 'recent')
      or case when jsonb_typeof(item.value) <> 'number' then true
              else (item.value #>> '{}')::numeric not between 0 and 5 end) then
    raise exception 'Poids invalides' using errcode = '22023';
  end if;
  insert into public.sorties_reglages (espace_id, user_id, max_notifs_par_jour, heure_semaine, heure_weekend, ton, poids_classement)
    values (p_espace, auth.uid(), p_max, p_semaine, p_weekend, p_ton, p_poids)
  on conflict (espace_id, user_id) do update set
    max_notifs_par_jour = excluded.max_notifs_par_jour, heure_semaine = excluded.heure_semaine,
    heure_weekend = excluded.heure_weekend, ton = excluded.ton, poids_classement = excluded.poids_classement;
end;
$$;

create function public.sorties_abonner_push(p_espace uuid, p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.sorties_is_member(p_espace) then
    raise exception 'Espace inaccessible' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]#]+$'
    or length(p_endpoint) > 2000
    or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}=?$'
    or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}(==)?$' then
    raise exception 'Abonnement invalide' using errcode = '22023';
  end if;
  insert into public.sorties_push_subscriptions (user_id, endpoint, p256dh, auth)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id
    where sorties_push_subscriptions.p256dh = excluded.p256dh and sorties_push_subscriptions.auth = excluded.auth;
  if not found then raise exception 'Abonnement invalide' using errcode = '22023'; end if;
end;
$$;

create function public.sorties_desabonner_push(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.sorties_push_subscriptions where user_id = (select auth.uid()) and endpoint = p_endpoint;
$$;

create function public.sorties_repondre_rappel(p_id uuid, p_reponse text, p_jours integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.sorties_rappels%rowtype;
  v_jour date;
begin
  select * into r from public.sorties_rappels where id = p_id and user_id = (select auth.uid()) for update;
  if not found or not public.sorties_gere_suivis(r.espace_id) then
    raise exception 'Rappel inaccessible' using errcode = '42501';
  end if;
  if r.reponse is not null then return; end if;
  if not exists (
    select 1 from public.sorties_idees i where i.id = r.idee_id
      and i.statut in ('envie', 'preselection') and i.fusionnee_dans is null
      and ((r.type = 'suggestion' and i.date_limite_reservation is null and i.date_debut is null)
        or (r.type = 'echeance' and r.cycle = coalesce(i.date_limite_reservation, i.date_debut)
            - least(coalesce(i.preavis_semaines, 0), 5200) * 7))
  ) then raise exception 'Ce rappel n’est plus actuel' using errcode = '22023'; end if;
  if p_reponse is null or not (
    (p_reponse = 'reporte' and p_jours is not null and p_jours in (3, 7, 14) and not r.confirme_actualite)
    or (p_reponse = 'disponible' and r.type = 'suggestion' and not r.confirme_actualite)
    or (p_reponse = 'reserve' and r.type = 'echeance' and not r.confirme_actualite)
    or (p_reponse = 'archive' and (r.confirme_actualite or r.etape = 10))
    or (p_reponse in ('actuel', 'baisse') and r.confirme_actualite)
  ) then
    raise exception 'Réponse invalide' using errcode = '22023';
  end if;
  if p_reponse not in ('reserve', 'archive') and exists (
    select 1 from public.sorties_rappels x where x.idee_id = r.idee_id and x.user_id = r.user_id
      and x.type = r.type and x.cycle is not distinct from r.cycle and (x.prevu_le, x.id) > (r.prevu_le, r.id)
  ) then raise exception 'Ce rappel a été remplacé' using errcode = '22023'; end if;
  if p_reponse = 'reporte' then
    v_jour := (now() at time zone 'Europe/Zurich')::date + p_jours;
  end if;
  if p_reponse in ('archive', 'baisse') then
    update public.sorties_idees set
      statut = case when p_reponse = 'archive' then 'archivee' else statut end,
      urgence = case when p_reponse = 'baisse' then greatest(1, urgence - 1) else urgence end
    where id = r.idee_id and statut in ('envie', 'preselection');
  end if;
  update public.sorties_rappels set reponse = p_reponse,
    reporte_jusqua = v_jour::timestamp at time zone 'Europe/Zurich'
  where id = p_id;
end;
$$;

revoke execute on function public.sorties_gere_suivis(uuid), public.sorties_suivi_role(uuid), public.sorties_demander_suivi(uuid, boolean),
  public.sorties_decider_suivi(uuid, uuid, boolean), public.sorties_enregistrer_reglages(uuid, integer, time, time, text, jsonb),
  public.sorties_abonner_push(uuid, text, text, text), public.sorties_desabonner_push(text),
  public.sorties_repondre_rappel(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.sorties_gere_suivis(uuid), public.sorties_suivi_role(uuid), public.sorties_demander_suivi(uuid, boolean),
  public.sorties_decider_suivi(uuid, uuid, boolean), public.sorties_enregistrer_reglages(uuid, integer, time, time, text, jsonb),
  public.sorties_abonner_push(uuid, text, text, text), public.sorties_desabonner_push(text),
  public.sorties_repondre_rappel(uuid, text, integer) to authenticated;

-- Le plafond compte les rappels par personne et par journée suisse, tous
-- espaces et canaux confondus. Une livraison multi-appareils reste un rappel.
create function public.sorties_places_disponibles(p_user uuid, p_espace uuid, p_jour date) returns integer
language sql stable set search_path = '' as $$
  select greatest(0, coalesce((
    select least(max_notifs_par_jour, 2) from public.sorties_reglages
    where user_id = p_user and espace_id = p_espace
  ), 2) - (
    select count(*)::integer from public.sorties_notifications_outbox
    where user_id = p_user and jour_local = p_jour and annule_le is null
  ));
$$;

create function public.sorties_programmer_rappels(p_maintenant timestamptz default now()) returns integer
language plpgsql set search_path = '' as $$
declare
  suisse timestamp := p_maintenant at time zone 'Europe/Zurich';
  jour date := suisse::date;
  mois smallint := extract(month from suisse)::smallint;
  disponible integer;
  sortie record;
  destinataire record;
  prochain record;
  rappel uuid;
  total integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(48343, 3) then return 0; end if;

  -- Le délai de réaction dure jusqu'au changement de jour en Suisse.
  update public.sorties_idees i set statut = 'manquee'
  where i.statut in ('envie', 'preselection') and i.fusionnee_dans is null
    and not exists (select 1 from public.sorties_occurrences o where o.idee_id = i.id and o.statut = 'prevue')
    and exists (
      select 1 from public.sorties_rappels r
      join public.sorties_destinataires_rappel d on d.espace_id = r.espace_id and d.user_id = r.user_id
      join public.sorties_espace_membres m on m.espace_id = d.espace_id and m.user_id = d.user_id
      where r.idee_id = i.id and m.role in ('owner', 'membre')
        and r.cycle = coalesce(i.date_limite_reservation, i.date_debut) - least(coalesce(i.preavis_semaines, 0), 5200) * 7
        and r.type = 'echeance' and r.etape = 10 and r.reponse is null and not r.confirme_actualite
        and not exists (select 1 from public.sorties_rappels x where x.idee_id = i.id and x.user_id = r.user_id
          and x.type = 'echeance' and x.cycle = r.cycle and x.reponse = 'reserve')
        and (r.envoye_le at time zone 'Europe/Zurich')::date < jour
        and r.id = (select x.id from public.sorties_rappels x where x.idee_id = i.id and x.user_id = r.user_id
          and x.type = 'echeance' and x.cycle = r.cycle order by x.prevu_le desc, x.id desc limit 1)
    );

  for destinataire in
    select d.espace_id, d.user_id, r.poids_classement
    from public.sorties_destinataires_rappel d
    join public.sorties_espace_membres m using (espace_id, user_id)
    left join public.sorties_reglages r using (espace_id, user_id)
    where m.role in ('owner', 'membre') and suisse::time >= case when extract(isodow from suisse) >= 6
      then coalesce(r.heure_weekend, '10:00') else coalesce(r.heure_semaine, '18:30') end
    order by d.espace_id
  loop
    disponible := public.sorties_places_disponibles(destinataire.user_id, destinataire.espace_id, jour);
    if disponible = 0 then continue; end if;

    for sortie in
      with idees as (
        select i.*, coalesce(i.date_limite_reservation, i.date_debut) - least(coalesce(i.preavis_semaines, 0), 5200) * 7 as debut_cycle
        from public.sorties_idees i
        where i.espace_id = destinataire.espace_id and i.statut in ('envie', 'preselection')
          and i.fusionnee_dans is null and coalesce(i.date_limite_reservation, i.date_debut) is not null
          and not exists (select 1 from public.sorties_occurrences o where o.idee_id = i.id and o.statut = 'prevue')
      ), echeances as (
        select i.*, dernier.id as dernier_id, dernier.etape as etape_avant, dernier.reponse as derniere_reponse,
          dernier.reporte_jusqua,
          coalesce((select max(r.etape) from public.sorties_rappels r
            where r.idee_id = i.id and r.user_id = destinataire.user_id and r.type = 'echeance' and r.cycle = i.debut_cycle), -1) as deja,
          (select count(*) from public.sorties_rappels r
            where r.idee_id = i.id and r.user_id = destinataire.user_id and r.type = 'echeance'
              and r.cycle = i.debut_cycle and r.reponse = 'reporte') as reports
        from idees i
        left join lateral (select id, etape, reponse, reporte_jusqua from public.sorties_rappels r
          where r.idee_id = i.id and r.user_id = destinataire.user_id and r.type = 'echeance'
            and r.cycle = i.debut_cycle order by r.prevu_le desc, r.id desc limit 1) dernier on true
        where i.debut_cycle <= jour
          and not exists (select 1 from public.sorties_rappels x where x.idee_id = i.id and x.user_id = destinataire.user_id
            and x.type = 'echeance' and x.cycle = i.debut_cycle and x.reponse = 'reserve')
          and not exists (select 1 from public.sorties_rappels x where x.idee_id = i.id and x.user_id = destinataire.user_id
            and x.type = 'echeance' and x.cycle = i.debut_cycle and (x.prevu_le at time zone 'Europe/Zurich')::date = jour)
      )
      select e.id, e.debut_cycle, case when e.derniere_reponse = 'reporte' then e.etape_avant else phase.etape end as etape,
        case when e.derniere_reponse = 'reporte' then 'report:' || e.dernier_id
             else e.debut_cycle || ':' || phase.etape end as cle,
        coalesce(e.derniere_reponse = 'reporte' and e.reports >= 2, false) as confirmer
      from echeances e
      left join lateral (select max(k) as etape from unnest(array[0,3,7,10]) k
        where k <= jour - e.debut_cycle and k > e.deja) phase on true
      where (e.derniere_reponse = 'reporte' and e.reporte_jusqua <= p_maintenant)
        or (coalesce(e.derniere_reponse, '') not in ('reserve', 'archive', 'reporte') and phase.etape is not null)
      order by e.urgence desc, e.debut_cycle, e.id limit disponible
    loop
      rappel := null;
      insert into public.sorties_rappels (espace_id, idee_id, user_id, type, etape, prevu_le, cycle, cle, confirme_actualite, motif)
      values (destinataire.espace_id, sortie.id, destinataire.user_id, 'echeance', sortie.etape, p_maintenant,
        sortie.debut_cycle, sortie.cle, sortie.confirmer, 'Un délai de réservation approche.')
      on conflict (idee_id, user_id, type, cle) do nothing returning id into rappel;
      if rappel is not null then
        insert into public.sorties_notifications_outbox (espace_id, user_id, rappel_id, jour_local, kind, canal, created_at)
        values (destinataire.espace_id, destinataire.user_id, rappel, jour, 'rappel',
          case when sortie.etape = 7 and not sortie.confirmer then 'email' else 'push' end, p_maintenant);
        total := total + 1;
      end if;
    end loop;

    if public.sorties_places_disponibles(destinataire.user_id, destinataire.espace_id, jour) = 0
      or exists (select 1 from public.sorties_rappels r where r.user_id = destinataire.user_id
        and r.type = 'suggestion' and (r.prevu_le at time zone 'Europe/Zurich')::date = jour) then
      continue;
    end if;

    select c.id, c.confirmer, c.motif into prochain
    from (
      select i.id, i.urgence, i.nb_ajouts, s.score,
        coalesce(h.reponse = 'reporte' and coalesce(histoire.reports, 0) >= 2, false) as confirmer,
        concat_ws(' · ',
          case when s.score is not null then 'Envie ' || round(s.score, 1) || '/10' else 'Une idée à découvrir' end,
          'urgence ' || i.urgence || '/5',
          case when mois = any(i.meilleure_periode) then 'bonne période' end,
          case when i.nb_ajouts > 1 then i.nb_ajouts || ' ajouts' end) as motif,
        coalesce(h.reponse = 'reporte', false) as revient,
        power(coalesce(s.score, 5) / 10, coalesce((destinataire.poids_classement->>'envie')::numeric, 1))
        * power(i.urgence::numeric / 5, coalesce((destinataire.poids_classement->>'urgence')::numeric, 1))
        * power(case when mois = any(i.meilleure_periode) then 1.25 when cardinality(i.meilleure_periode) = 0 then 1 else 0.6 end,
          coalesce((destinataire.poids_classement->>'saison')::numeric, 1))
        + least(i.nb_ajouts - 1, 10) * 0.08 * coalesce((destinataire.poids_classement->>'ajouts')::numeric, 1)
        - case when h.prevu_le >= p_maintenant - interval '7 days'
          then 0.35 * coalesce((destinataire.poids_classement->>'recent')::numeric, 1) else 0 end as rang
      from public.sorties_idees i
      left join public.sorties_scores_couple s on s.idee_id = i.id
      left join lateral (select r.reponse, r.prevu_le, r.reporte_jusqua from public.sorties_rappels r
        where r.idee_id = i.id and r.user_id = destinataire.user_id and r.type = 'suggestion'
        order by r.prevu_le desc, r.id desc limit 1) h on true
      left join lateral (select count(*) as reports from public.sorties_rappels r
        where r.idee_id = i.id and r.user_id = destinataire.user_id and r.type = 'suggestion' and r.reponse = 'reporte'
          and r.prevu_le > coalesce((select max(x.prevu_le) from public.sorties_rappels x where x.idee_id = i.id
            and x.user_id = destinataire.user_id and x.type = 'suggestion' and x.confirme_actualite), '-infinity')) histoire on true
      where i.espace_id = destinataire.espace_id and i.statut in ('envie', 'preselection') and i.fusionnee_dans is null
        and i.date_limite_reservation is null and i.date_debut is null
        and (h.prevu_le is null or (h.reponse = 'reporte' and h.reporte_jusqua <= p_maintenant)
          or (coalesce(h.reponse, '') <> 'reporte' and h.prevu_le < p_maintenant - interval '2 days'))
        and not exists (select 1 from public.sorties_occurrences o where o.idee_id = i.id and o.statut = 'prevue')
    ) c order by c.revient desc, c.rang desc, c.id limit 1;

    if found then
      rappel := null;
      insert into public.sorties_rappels (espace_id, idee_id, user_id, type, prevu_le, cle, confirme_actualite, motif)
      values (destinataire.espace_id, prochain.id, destinataire.user_id, 'suggestion', p_maintenant,
        jour::text, prochain.confirmer, prochain.motif)
      on conflict (idee_id, user_id, type, cle) do nothing returning id into rappel;
      if rappel is not null then
        insert into public.sorties_notifications_outbox (espace_id, user_id, rappel_id, jour_local, kind, canal, created_at)
        values (destinataire.espace_id, destinataire.user_id, rappel, jour, 'suggestion', 'push', p_maintenant);
        total := total + 1;
      end if;
    end if;
  end loop;

  -- Les suivis sont indépendants du rappel privé. Un consentement postérieur
  -- au rappel J7 ne déclenche aucun rattrapage.
  for sortie in
    select r.id, r.espace_id, s.demandeuse
    from public.sorties_rappels r join public.sorties_suivis s using (idee_id, espace_id)
    join public.sorties_idees i on i.id = r.idee_id
    join public.sorties_destinataires_rappel d on d.espace_id = r.espace_id and d.user_id = r.user_id
    left join public.sorties_reglages g on g.espace_id = s.espace_id and g.user_id = s.demandeuse
    where r.type = 'echeance' and r.etape = 7 and not r.confirme_actualite and r.reponse is null
      and r.cle = r.cycle || ':7' and s.statut = 'accepte' and s.decide_le <= r.prevu_le
      and s.demandeuse <> r.user_id and (r.prevu_le at time zone 'Europe/Zurich')::date = jour
      and i.statut in ('envie', 'preselection') and i.fusionnee_dans is null
      and suisse::time >= case when extract(isodow from suisse) >= 6 then coalesce(g.heure_weekend, '10:00')
        else coalesce(g.heure_semaine, '18:30') end
    order by r.prevu_le, r.id, s.demandeuse
  loop
    if public.sorties_places_disponibles(sortie.demandeuse, sortie.espace_id, jour) > 0 then
      insert into public.sorties_notifications_outbox (espace_id, user_id, rappel_id, jour_local, kind, canal, created_at)
      values (sortie.espace_id, sortie.demandeuse, sortie.id, jour, 'suivi', 'push', p_maintenant)
      on conflict (rappel_id, user_id, kind) do nothing;
      if found then total := total + 1; end if;
    end if;
  end loop;
  return total;
end;
$$;

-- Vérification répétée juste avant le transport. Les poussées de suivi ne
-- transportent jamais le motif ni l'étape du rappel privé.
create function public.sorties_notification_prete(p_id uuid, p_maintenant timestamptz default now()) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('idee_id', i.id, 'rappel_id', case when o.kind <> 'suivi' then r.id end,
    'etape', case when o.kind <> 'suivi' then r.etape end,
    'confirme_actualite', o.kind <> 'suivi' and r.confirme_actualite,
    'ton', coalesce(g.ton, 'direct_humour'))
  from public.sorties_notifications_outbox o
  join public.sorties_rappels r on r.id = o.rappel_id and r.espace_id = o.espace_id
  join public.sorties_idees i on i.id = r.idee_id and i.espace_id = r.espace_id
  join public.sorties_destinataires_rappel d on d.espace_id = r.espace_id and d.user_id = r.user_id
  join public.sorties_espace_membres m on m.espace_id = d.espace_id and m.user_id = d.user_id
  left join public.sorties_reglages g on g.espace_id = o.espace_id and g.user_id = o.user_id
  where o.id = p_id and o.annule_le is null and o.sent_at is null
    and o.jour_local = (p_maintenant at time zone 'Europe/Zurich')::date
    and r.reponse is null and i.statut in ('envie', 'preselection') and i.fusionnee_dans is null
    and m.role in ('owner', 'membre')
    and not exists (select 1 from public.sorties_occurrences x where x.idee_id = i.id and x.statut = 'prevue')
    and not exists (select 1 from public.sorties_rappels x where x.idee_id = i.id and x.user_id = r.user_id
      and x.type = 'echeance' and x.cycle = r.cycle and x.reponse = 'reserve')
    and ((r.type = 'suggestion' and i.date_limite_reservation is null and i.date_debut is null)
      or (r.type = 'echeance' and r.cycle = coalesce(i.date_limite_reservation, i.date_debut)
        - least(coalesce(i.preavis_semaines, 0), 5200) * 7))
    and ((o.kind in ('rappel', 'suggestion') and o.user_id = r.user_id)
      or (o.kind = 'suivi' and r.type = 'echeance' and r.etape = 7 and not r.confirme_actualite
        and r.cle = r.cycle || ':7' and o.user_id <> r.user_id
        and exists (select 1 from public.sorties_suivis s
          where s.espace_id = o.espace_id and s.idee_id = i.id and s.demandeuse = o.user_id
            and s.statut = 'accepte' and s.decide_le <= r.prevu_le)))
    and (select count(*) from public.sorties_notifications_outbox x
      where x.user_id = o.user_id and x.jour_local = o.jour_local and x.annule_le is null
        and (x.created_at, x.id) <= (o.created_at, o.id)) <= least(coalesce(g.max_notifs_par_jour, 2), 2);
$$;

create function public.sorties_reclamer_notifications(p_limite integer default 15)
returns setof public.sorties_notifications_outbox
language plpgsql set search_path = '' as $$
begin
  update public.sorties_notifications_outbox o set annule_le = now()
  where sent_at is null and annule_le is null and rappel_id is not null
    and (jour_local < (now() at time zone 'Europe/Zurich')::date or attempts >= 5
      or public.sorties_notification_prete(o.id) is null)
    and (claimed_at is null or claimed_at < now() - interval '3 minutes');
  return query
    with a_envoyer as (
      select id from public.sorties_notifications_outbox
      where sent_at is null and annule_le is null and rappel_id is not null and attempts < 5
        and (claimed_at is null or claimed_at < now() - interval '3 minutes')
      order by created_at, id limit least(greatest(p_limite, 1), 30) for update skip locked
    )
    update public.sorties_notifications_outbox o set claimed_at = now(), attempts = o.attempts + 1
    from a_envoyer a where o.id = a.id returning o.*;
end;
$$;

create function public.sorties_clore_notification(
  p_id uuid, p_bail timestamptz, p_etat text, p_canal text default null
) returns void language plpgsql set search_path = '' as $$
declare
  o public.sorties_notifications_outbox%rowtype;
begin
  if p_etat is null or p_etat not in ('envoye', 'annule', 'indisponible', 'temporaire')
    or (p_etat = 'envoye' and (p_canal is null or p_canal not in ('email', 'push'))) then
    raise exception 'État invalide' using errcode = '22023';
  end if;
  update public.sorties_notifications_outbox set
    sent_at = case when p_etat = 'envoye' then now() end,
    annule_le = case when p_etat in ('annule', 'indisponible') then now() end,
    canal = coalesce(p_canal, canal),
    last_error = case when p_etat in ('indisponible', 'temporaire') then p_etat end
  where id = p_id and claimed_at = p_bail and sent_at is null and annule_le is null
  returning * into o;
  if found and p_etat = 'envoye' and o.kind in ('rappel', 'suggestion') then
    update public.sorties_rappels set envoye_le = now(), canal = p_canal
      where id = o.rappel_id and user_id = o.user_id;
  end if;
end;
$$;

create function public.sorties_cron_notifications() returns void
language plpgsql set search_path = '' as $$
declare
  jeton text;
  adresse text;
begin
  select decrypted_secret into jeton from vault.decrypted_secrets where name = 'eureka_notify_secret' limit 1;
  select decrypted_secret into adresse from vault.decrypted_secrets where name = 'eureka_notify_url' limit 1;
  if jeton is null or length(jeton) < 24 or adresse is null
    or adresse !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/sorties-notify$' then return; end if;

  perform public.sorties_programmer_rappels();
  if exists (select 1 from public.sorties_notifications_outbox o where o.rappel_id is not null
    and o.sent_at is null and o.annule_le is null and o.attempts < 5
    and o.jour_local = (now() at time zone 'Europe/Zurich')::date
    and (o.claimed_at is null or o.claimed_at < now() - interval '3 minutes')) then
    perform net.http_post(url := adresse,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', jeton),
      body := '{}'::jsonb, timeout_milliseconds := 5000);
  end if;
  delete from public.sorties_notifications_outbox
    where rappel_id is not null and jour_local < (now() at time zone 'Europe/Zurich')::date - 30;
end;
$$;

revoke execute on function public.sorties_places_disponibles(uuid, uuid, date), public.sorties_programmer_rappels(timestamptz),
  public.sorties_notification_prete(uuid, timestamptz), public.sorties_reclamer_notifications(integer),
  public.sorties_clore_notification(uuid, timestamptz, text, text), public.sorties_cron_notifications()
  from public, anon, authenticated;
grant execute on function public.sorties_places_disponibles(uuid, uuid, date), public.sorties_programmer_rappels(timestamptz),
  public.sorties_notification_prete(uuid, timestamptz), public.sorties_reclamer_notifications(integer),
  public.sorties_clore_notification(uuid, timestamptz, text, text)
  to service_role;

-- Sans les deux entrées Vault, ce job ne met rien en file et n'émet aucun appel.
select cron.schedule('eureka-rappels', '* * * * *', 'select public.sorties_cron_notifications()');

commit;
