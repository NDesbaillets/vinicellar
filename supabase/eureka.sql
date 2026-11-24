-- Eurêka, Vivcolas ! · Schéma initial.
-- Le premier espace et ses membres sont provisionnés par le propriétaire du projet.
-- Extensions requises dans le schéma extensions : unaccent et pg_trgm.
begin;

create table public.sorties_espaces (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (btrim(nom) <> ''),
  plafond_ia_mensuel_chf numeric(10,2) not null default 10
    check (plafond_ia_mensuel_chf >= 0 and plafond_ia_mensuel_chf <> 'NaN'::numeric),
  cree_le timestamptz not null default now()
);
alter table public.sorties_espaces enable row level security;

create table public.sorties_espace_membres (
  espace_id uuid not null references public.sorties_espaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'membre' check (role in ('owner', 'membre', 'lecteur')),
  prenom_affiche text not null check (btrim(prenom_affiche) <> ''),
  primary key (espace_id, user_id)
);
alter table public.sorties_espace_membres enable row level security;
create index sorties_espace_membres_user_idx on public.sorties_espace_membres (user_id, espace_id);

-- Le propriétaire des fonctions peut lire les appartenances sans récursion RLS.
create function public.sorties_is_member(espace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sorties_espace_membres
    where espace_id = espace and user_id = (select auth.uid())
  );
$$;

create function public.sorties_is_editor(espace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sorties_espace_membres
    where espace_id = espace and user_id = (select auth.uid()) and role in ('owner', 'membre')
  );
$$;

create function public.sorties_is_owner(espace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sorties_espace_membres
    where espace_id = espace and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

revoke execute on function public.sorties_is_member(uuid), public.sorties_is_editor(uuid),
  public.sorties_is_owner(uuid) from public, anon, authenticated;
grant execute on function public.sorties_is_member(uuid), public.sorties_is_editor(uuid),
  public.sorties_is_owner(uuid) to authenticated;

-- Dictionnaire explicite pour garder la même normalisation en index et en requête.
create function public.sorties_unaccent(texte text) returns text
language sql immutable strict set search_path = '' as $$
  select extensions.unaccent('extensions.unaccent'::pg_catalog.regdictionary, texte);
$$;

create table public.sorties_idees (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.sorties_espaces on delete cascade,
  titre text not null check (btrim(titre) <> ''),
  accroche text,
  description text,
  categorie text,
  tags text[] not null default '{}',
  format text check (format in ('demi_journee', 'journee', 'week_end', 'sejour')),
  type_lieu text not null default 'generique' check (type_lieu in ('lieu', 'generique')),
  adresse text,
  ville text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  distance_nyon_km numeric(8,2) check (distance_nyon_km >= 0 and distance_nyon_km <> 'NaN'::numeric),
  modalite text check (modalite in ('couple', 'seul')),
  site_reservation text,
  telephone text,
  budget_min numeric(10,2) check (budget_min >= 0 and budget_min <> 'NaN'::numeric),
  budget_max numeric(10,2) check (budget_max >= 0 and budget_max <> 'NaN'::numeric),
  meilleure_periode smallint[] not null default '{}'
    check (meilleure_periode <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  preavis_semaines integer check (preavis_semaines >= 0),
  date_debut date,
  date_fin date,
  date_limite_reservation date,
  urgence smallint not null default 1 check (urgence between 1 and 5),
  statut text not null default 'envie'
    check (statut in ('envie', 'preselection', 'planifiee', 'faite', 'archivee', 'manquee')),
  score_couple_manuel smallint check (score_couple_manuel between 0 and 10),
  recurrence_mois integer check (recurrence_mois > 0),
  image_path text,
  source_url text,
  source_type text not null default 'texte' check (source_type in ('texte', 'lien', 'reel', 'photo', 'web')),
  notes text,
  ajoutee_par uuid default auth.uid() references auth.users on delete set null,
  nb_ajouts integer not null default 1 check (nb_ajouts > 0),
  fusionnee_dans uuid,
  a_verifier jsonb not null default '{}' check (jsonb_typeof(a_verifier) = 'object'),
  tsv tsvector not null,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (espace_id, id),
  foreign key (espace_id, fusionnee_dans) references public.sorties_idees (espace_id, id)
    on delete set null (fusionnee_dans),
  check (fusionnee_dans <> id),
  check (budget_max >= budget_min),
  check (date_fin >= date_debut),
  check ((lat is null) = (lng is null))
);
alter table public.sorties_idees enable row level security;

create function public.sorties_indexer_idee() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.maj_le := now();
  new.tsv :=
    setweight(to_tsvector('pg_catalog.french', public.sorties_unaccent(new.titre)), 'A')
    || setweight(to_tsvector('pg_catalog.french', public.sorties_unaccent(
      concat_ws(' ', new.accroche, new.ville, new.adresse, array_to_string(new.tags, ' ')))), 'B')
    || setweight(to_tsvector('pg_catalog.french', public.sorties_unaccent(
      concat_ws(' ', new.description, new.notes))), 'C');
  return new;
end;
$$;

create trigger sorties_idees_indexer before insert or update on public.sorties_idees
for each row execute function public.sorties_indexer_idee();

-- Pour la recherche : tsv @@ websearch_to_tsquery('pg_catalog.french', sorties_unaccent(...)).
create index sorties_idees_tsv_idx on public.sorties_idees using gin (tsv);
create index sorties_idees_titre_trgm_idx on public.sorties_idees
  using gin (lower(public.sorties_unaccent(titre)) extensions.gin_trgm_ops);
create index sorties_idees_periode_idx on public.sorties_idees using gin (meilleure_periode);
create index sorties_idees_statut_idx on public.sorties_idees (espace_id, statut);
create index sorties_idees_fusion_idx on public.sorties_idees (espace_id, fusionnee_dans)
  where fusionnee_dans is not null;

create table public.sorties_envies (
  idee_id uuid not null references public.sorties_idees on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  score smallint not null check (score between 0 and 10),
  maj_le timestamptz not null default now(),
  primary key (idee_id, user_id)
);
alter table public.sorties_envies enable row level security;

create function public.sorties_dater_envie() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.maj_le := now();
  return new;
end;
$$;

create trigger sorties_envies_dater before insert or update on public.sorties_envies
for each row execute function public.sorties_dater_envie();

create table public.sorties_options (
  id uuid primary key default gen_random_uuid(),
  idee_id uuid not null references public.sorties_idees on delete cascade,
  nom text not null check (btrim(nom) <> ''),
  lieu text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  lien text,
  note text,
  check ((lat is null) = (lng is null))
);
alter table public.sorties_options enable row level security;
create index sorties_options_idee_idx on public.sorties_options (idee_id);

create table public.sorties_occurrences (
  id uuid primary key default gen_random_uuid(),
  idee_id uuid not null references public.sorties_idees on delete cascade,
  date_cible date not null,
  date_realisee date,
  statut text not null default 'prevue' check (statut in ('prevue', 'faite', 'annulee')),
  evenement_ref text
);
alter table public.sorties_occurrences enable row level security;
create index sorties_occurrences_idee_idx on public.sorties_occurrences (idee_id, date_cible);

create table public.sorties_notes_occurrence (
  occurrence_id uuid not null references public.sorties_occurrences on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  note text,
  commentaire text,
  primary key (occurrence_id, user_id)
);
alter table public.sorties_notes_occurrence enable row level security;

-- Structures réservées aux étapes suivantes. RLS sans politique client à ce stade.
create table public.sorties_personnes (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.sorties_espaces on delete cascade,
  nom text not null check (btrim(nom) <> ''),
  rythme_mois integer check (rythme_mois > 0),
  unique (espace_id, id)
);
alter table public.sorties_personnes enable row level security;

create table public.sorties_idees_personnes (
  espace_id uuid not null,
  idee_id uuid not null,
  personne_id uuid not null,
  primary key (espace_id, idee_id, personne_id),
  foreign key (espace_id, idee_id) references public.sorties_idees (espace_id, id) on delete cascade,
  foreign key (espace_id, personne_id) references public.sorties_personnes (espace_id, id) on delete cascade
);
alter table public.sorties_idees_personnes enable row level security;

create table public.sorties_inbox (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.sorties_espaces on delete cascade,
  user_id uuid not null,
  type text not null check (type in ('lien', 'texte', 'photo')),
  contenu text,
  image_path text,
  statut text not null default 'nouveau' check (statut in ('nouveau', 'en_cours', 'traite', 'echec')),
  idee_id uuid,
  erreur text,
  cree_le timestamptz not null default now(),
  foreign key (espace_id, user_id) references public.sorties_espace_membres on delete cascade,
  foreign key (espace_id, idee_id) references public.sorties_idees (espace_id, id) on delete set null (idee_id),
  check (case when type = 'photo' then nullif(btrim(image_path), '') is not null
              else nullif(btrim(contenu), '') is not null end)
);
alter table public.sorties_inbox enable row level security;

create table public.sorties_rappels (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null,
  idee_id uuid not null,
  user_id uuid not null,
  type text not null check (type in ('echeance', 'suggestion')),
  etape smallint not null default 0 check (etape in (0, 3, 7, 10)),
  prevu_le timestamptz not null,
  envoye_le timestamptz,
  canal text,
  reponse text check (reponse in ('reserve', 'reporte', 'archive')),
  reporte_jusqua timestamptz,
  foreign key (espace_id, idee_id) references public.sorties_idees (espace_id, id) on delete cascade,
  foreign key (espace_id, user_id) references public.sorties_espace_membres on delete cascade,
  check (type <> 'suggestion' or etape = 0)
);
alter table public.sorties_rappels enable row level security;

create table public.sorties_suivis (
  espace_id uuid not null,
  idee_id uuid not null,
  demandeuse uuid not null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'accepte', 'refuse')),
  cree_le timestamptz not null default now(),
  decide_le timestamptz,
  primary key (idee_id, demandeuse),
  foreign key (espace_id, idee_id) references public.sorties_idees (espace_id, id) on delete cascade,
  foreign key (espace_id, demandeuse) references public.sorties_espace_membres on delete cascade,
  check ((statut = 'en_attente') = (decide_le is null))
);
alter table public.sorties_suivis enable row level security;

create table public.sorties_calendriers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  nom text not null,
  href text not null,
  actif boolean not null default false,
  mode text not null default 'occupe' check (mode in ('occupe', 'titres')),
  ecriture boolean not null default false,
  unique (user_id, href),
  unique (user_id, id),
  check (actif or (mode = 'occupe' and not ecriture))
);
alter table public.sorties_calendriers enable row level security;

create table public.sorties_reglages (
  user_id uuid not null,
  espace_id uuid not null,
  max_notifs_par_jour integer not null default 2 check (max_notifs_par_jour >= 0),
  heure_semaine time not null default '18:30',
  heure_weekend time not null default '10:00',
  ton text not null default 'direct_humour' check (ton in ('direct_humour', 'neutre')),
  poids_classement jsonb not null default '{}' check (jsonb_typeof(poids_classement) = 'object'),
  calendrier_ecriture_id uuid,
  primary key (espace_id, user_id),
  foreign key (espace_id, user_id) references public.sorties_espace_membres on delete cascade,
  foreign key (user_id, calendrier_ecriture_id) references public.sorties_calendriers (user_id, id)
    on delete set null (calendrier_ecriture_id)
);
alter table public.sorties_reglages enable row level security;

create table public.sorties_occupation (
  id uuid primary key default gen_random_uuid(),
  calendrier_id uuid not null references public.sorties_calendriers on delete cascade,
  debut timestamptz not null,
  fin timestamptz not null check (fin > debut),
  titre text,
  uid_externe text not null,
  maj_le timestamptz not null default now(),
  unique (calendrier_id, uid_externe, debut)
);
alter table public.sorties_occupation enable row level security;

create table public.sorties_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique check (length(endpoint) between 10 and 2000),
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 100),
  created_at timestamptz not null default now()
);
alter table public.sorties_push_subscriptions enable row level security;
create index sorties_push_subscriptions_user_idx on public.sorties_push_subscriptions (user_id);

create table public.sorties_notifications_outbox (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null,
  user_id uuid not null,
  kind text not null,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  last_error text,
  foreign key (espace_id, user_id) references public.sorties_espace_membres on delete cascade
);
alter table public.sorties_notifications_outbox enable row level security;
create index sorties_notifications_outbox_pending_idx
  on public.sorties_notifications_outbox (created_at) where sent_at is null;

-- Privilèges explicites, indépendants des privilèges par défaut du projet.
revoke all on
  public.sorties_espaces, public.sorties_espace_membres, public.sorties_idees,
  public.sorties_envies, public.sorties_options, public.sorties_occurrences, public.sorties_notes_occurrence,
  public.sorties_personnes, public.sorties_idees_personnes, public.sorties_inbox,
  public.sorties_rappels, public.sorties_suivis, public.sorties_calendriers,
  public.sorties_reglages, public.sorties_occupation, public.sorties_push_subscriptions,
  public.sorties_notifications_outbox
from public, anon, authenticated;

grant all on
  public.sorties_espaces, public.sorties_espace_membres, public.sorties_idees,
  public.sorties_envies, public.sorties_options, public.sorties_occurrences, public.sorties_notes_occurrence,
  public.sorties_personnes, public.sorties_idees_personnes, public.sorties_inbox,
  public.sorties_rappels, public.sorties_suivis, public.sorties_calendriers,
  public.sorties_reglages, public.sorties_occupation, public.sorties_push_subscriptions,
  public.sorties_notifications_outbox
to service_role;

revoke execute on function public.sorties_unaccent(text),
  public.sorties_indexer_idee(), public.sorties_dater_envie() from public, anon, authenticated;
grant execute on function public.sorties_unaccent(text) to authenticated, service_role;

grant select on public.sorties_espaces, public.sorties_espace_membres to authenticated;
grant update (nom, plafond_ia_mensuel_chf) on public.sorties_espaces to authenticated;
create policy sorties_espaces_lecture on public.sorties_espaces for select to authenticated
  using (public.sorties_is_member(id));
create policy sorties_espaces_modification on public.sorties_espaces for update to authenticated
  using (public.sorties_is_owner(id)) with check (public.sorties_is_owner(id));
create policy sorties_espace_membres_lecture on public.sorties_espace_membres for select to authenticated
  using (public.sorties_is_member(espace_id));

grant select, delete on public.sorties_idees to authenticated;
grant insert (espace_id, titre, accroche, description, categorie, tags, format, type_lieu, adresse,
  ville, lat, lng, distance_nyon_km, modalite, site_reservation, telephone, budget_min, budget_max,
  meilleure_periode, preavis_semaines, date_debut, date_fin, date_limite_reservation, urgence, statut,
  score_couple_manuel, recurrence_mois, image_path, source_url, source_type, notes, nb_ajouts,
  fusionnee_dans, a_verifier) on public.sorties_idees to authenticated;
grant update (titre, accroche, description, categorie, tags, format, type_lieu, adresse,
  ville, lat, lng, distance_nyon_km, modalite, site_reservation, telephone, budget_min, budget_max,
  meilleure_periode, preavis_semaines, date_debut, date_fin, date_limite_reservation, urgence, statut,
  score_couple_manuel, recurrence_mois, image_path, source_url, source_type, notes, nb_ajouts,
  fusionnee_dans, a_verifier) on public.sorties_idees to authenticated;

create policy sorties_idees_lecture on public.sorties_idees for select to authenticated
  using (public.sorties_is_member(espace_id));
create policy sorties_idees_ajout on public.sorties_idees for insert to authenticated
  with check (public.sorties_is_editor(espace_id) and ajoutee_par = (select auth.uid()));
create policy sorties_idees_modification on public.sorties_idees for update to authenticated
  using (public.sorties_is_editor(espace_id)) with check (public.sorties_is_editor(espace_id));
create policy sorties_idees_suppression on public.sorties_idees for delete to authenticated
  using (public.sorties_is_editor(espace_id));

grant select, delete on public.sorties_envies, public.sorties_options, public.sorties_occurrences,
  public.sorties_notes_occurrence to authenticated;
grant insert (idee_id, user_id, score), update (score) on public.sorties_envies to authenticated;
grant insert (idee_id, nom, lieu, lat, lng, lien, note), update (nom, lieu, lat, lng, lien, note)
  on public.sorties_options to authenticated;
grant insert (idee_id, date_cible, date_realisee, statut), update (date_cible, date_realisee, statut)
  on public.sorties_occurrences to authenticated;
grant insert (occurrence_id, user_id, note, commentaire), update (note, commentaire)
  on public.sorties_notes_occurrence to authenticated;

create policy sorties_envies_lecture on public.sorties_envies for select to authenticated
  using (exists (select 1 from public.sorties_idees i where i.id = sorties_envies.idee_id));
create policy sorties_envies_ecriture on public.sorties_envies for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.sorties_idees i where i.id = sorties_envies.idee_id
      and public.sorties_is_editor(i.espace_id)))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.sorties_idees i where i.id = sorties_envies.idee_id
      and public.sorties_is_editor(i.espace_id)));

create policy sorties_options_lecture on public.sorties_options for select to authenticated
  using (exists (select 1 from public.sorties_idees i where i.id = sorties_options.idee_id));
create policy sorties_options_ecriture on public.sorties_options for all to authenticated
  using (exists (select 1 from public.sorties_idees i where i.id = sorties_options.idee_id
      and public.sorties_is_editor(i.espace_id)))
  with check (exists (select 1 from public.sorties_idees i where i.id = sorties_options.idee_id
      and public.sorties_is_editor(i.espace_id)));

create policy sorties_occurrences_lecture on public.sorties_occurrences for select to authenticated
  using (exists (select 1 from public.sorties_idees i where i.id = sorties_occurrences.idee_id));
create policy sorties_occurrences_ecriture on public.sorties_occurrences for all to authenticated
  using (exists (select 1 from public.sorties_idees i where i.id = sorties_occurrences.idee_id
      and public.sorties_is_editor(i.espace_id)))
  with check (exists (select 1 from public.sorties_idees i where i.id = sorties_occurrences.idee_id
      and public.sorties_is_editor(i.espace_id)));

create policy sorties_notes_occurrence_lecture on public.sorties_notes_occurrence for select to authenticated
  using (exists (select 1 from public.sorties_occurrences o
    join public.sorties_idees i on i.id = o.idee_id
    where o.id = sorties_notes_occurrence.occurrence_id));
create policy sorties_notes_occurrence_ecriture on public.sorties_notes_occurrence for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.sorties_occurrences o
    join public.sorties_idees i on i.id = o.idee_id
    where o.id = sorties_notes_occurrence.occurrence_id
      and public.sorties_is_editor(i.espace_id)))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.sorties_occurrences o
    join public.sorties_idees i on i.id = o.idee_id
    where o.id = sorties_notes_occurrence.occurrence_id
      and public.sorties_is_editor(i.espace_id)));

-- La vue respecte les politiques des idées et des envies de l'appelant (PostgreSQL 15+).
create view public.sorties_scores_couple with (security_invoker = true) as
select i.id as idee_id, i.espace_id, coalesce(i.score_couple_manuel, moyenne.score) as score
from public.sorties_idees i
left join lateral (
  select avg(e.score) as score
  from public.sorties_envies e
  join public.sorties_espace_membres m on m.espace_id = i.espace_id and m.user_id = e.user_id
  where e.idee_id = i.id
) moyenne on true;

revoke all on public.sorties_scores_couple from public, anon, authenticated;
grant select on public.sorties_scores_couple to authenticated, service_role;

commit;
