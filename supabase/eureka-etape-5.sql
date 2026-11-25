-- Eurêka · suppression des fiches. À appliquer après eureka-etape-2.sql.
begin;

-- L'entrée d'import appartient à cette fiche. La conserver après suppression
-- laisserait le texte et le chemin des photos sans fiche accessible.
alter table public.sorties_inbox
  drop constraint if exists sorties_inbox_espace_id_idee_id_fkey,
  add constraint sorties_inbox_espace_id_idee_id_fkey
    foreign key (espace_id, idee_id) references public.sorties_idees (espace_id, id) on delete cascade;

create table if not exists public.sorties_photos_a_supprimer (
  chemin text primary key,
  espace_id uuid not null references public.sorties_espaces on delete cascade,
  idee_id uuid not null
);
alter table public.sorties_photos_a_supprimer enable row level security;
create index if not exists sorties_photos_a_supprimer_espace_idx
  on public.sorties_photos_a_supprimer (espace_id, idee_id, chemin);
revoke all on public.sorties_photos_a_supprimer from public, anon, authenticated;
grant select on public.sorties_photos_a_supprimer to authenticated;
grant all on public.sorties_photos_a_supprimer to service_role;

drop policy if exists sorties_photos_a_supprimer_lecture on public.sorties_photos_a_supprimer;
create policy sorties_photos_a_supprimer_lecture on public.sorties_photos_a_supprimer
  for select to authenticated using (public.sorties_is_editor(espace_id));

create or replace function public.sorties_mettre_photos_en_suppression() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sorties_photos_a_supprimer (espace_id, idee_id, chemin)
  select old.espace_id, old.id, p.chemin from public.sorties_photos p
  where p.idee_id = old.id
    and p.chemin ~ ('^' || old.espace_id || '/[0-9a-f-]{36}/[0-9a-f-]{36}/[1-5]\.(jpg|png|webp)$')
  on conflict (chemin) do nothing;
  return old;
end;
$$;
revoke execute on function public.sorties_mettre_photos_en_suppression() from public, anon, authenticated;

drop trigger if exists sorties_idees_photos_avant_suppression on public.sorties_idees;
create trigger sorties_idees_photos_avant_suppression before delete on public.sorties_idees
  for each row execute function public.sorties_mettre_photos_en_suppression();

-- Storage requiert SELECT et DELETE. Les droits sont limités aux chemins
-- placés dans la file par le trigger et sans photo encore rattachée.
drop policy if exists sorties_photos_objets_lecture_nettoyage on storage.objects;
create policy sorties_photos_objets_lecture_nettoyage on storage.objects for select to authenticated
  using (bucket_id = 'eureka-photos' and exists (
    select 1 from public.sorties_photos_a_supprimer p
    where p.chemin = objects.name and public.sorties_is_editor(p.espace_id)
  ));

drop policy if exists sorties_photos_objets_suppression on storage.objects;
create policy sorties_photos_objets_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'eureka-photos' and exists (
    select 1 from public.sorties_photos_a_supprimer p
    where p.chemin = objects.name and public.sorties_is_editor(p.espace_id)
  ) and not exists (select 1 from public.sorties_photos p where p.chemin = objects.name));

-- La file est acquittée seulement si Storage a retiré l'objet.
create or replace function public.sorties_confirmer_suppression_photos(p_espace uuid, p_chemins text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare restant integer;
begin
  if not public.sorties_is_editor(p_espace) then
    raise exception 'Espace inaccessible' using errcode = '42501';
  end if;
  delete from public.sorties_photos_a_supprimer p
  where p.espace_id = p_espace and p.chemin = any(p_chemins)
    and not exists (select 1 from storage.objects o where o.bucket_id = 'eureka-photos' and o.name = p.chemin);
  select count(*) into restant from public.sorties_photos_a_supprimer
  where espace_id = p_espace and chemin = any(p_chemins);
  return restant;
end;
$$;
revoke execute on function public.sorties_confirmer_suppression_photos(uuid, text[]) from public, anon, authenticated;
grant execute on function public.sorties_confirmer_suppression_photos(uuid, text[]) to authenticated;

-- Gemini utilise le même registre et le même plafond que les autres appels.
create or replace function public.sorties_reserver_enrichissement(
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
  if p_kind not in ('sorties-apify', 'sorties-claude', 'sorties-gemini')
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

commit;
