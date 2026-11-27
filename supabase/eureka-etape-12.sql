-- Lieux de départ partagés et préférence principale propre à chaque membre.
begin;

create table if not exists public.sorties_lieux_depart (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.sorties_espaces on delete cascade,
  nom text not null check (char_length(btrim(nom)) between 1 and 80),
  ville text not null check (char_length(btrim(ville)) between 1 and 100),
  pays text not null check (char_length(btrim(pays)) between 1 and 80),
  par_defaut boolean not null default false,
  unique (espace_id, id),
  unique (espace_id, nom)
);
create unique index if not exists sorties_lieux_depart_defaut_idx
  on public.sorties_lieux_depart(espace_id) where par_defaut;

create table if not exists public.sorties_preferences_depart (
  espace_id uuid not null,
  user_id uuid not null default auth.uid(),
  lieu_id uuid not null,
  primary key (espace_id, user_id),
  foreign key (espace_id, user_id) references public.sorties_espace_membres on delete cascade,
  foreign key (espace_id, lieu_id) references public.sorties_lieux_depart(espace_id, id) on delete cascade
);

alter table public.sorties_lieux_depart enable row level security;
alter table public.sorties_preferences_depart enable row level security;
revoke all on public.sorties_lieux_depart, public.sorties_preferences_depart from public, anon, authenticated;
grant select on public.sorties_lieux_depart, public.sorties_preferences_depart to authenticated;
grant insert (espace_id, nom, ville, pays) on public.sorties_lieux_depart to authenticated;
grant insert (espace_id, user_id, lieu_id), update (espace_id, user_id, lieu_id)
  on public.sorties_preferences_depart to authenticated;
grant all on public.sorties_lieux_depart, public.sorties_preferences_depart to service_role;

drop policy if exists sorties_lieux_depart_lecture on public.sorties_lieux_depart;
create policy sorties_lieux_depart_lecture on public.sorties_lieux_depart for select to authenticated
  using (public.sorties_is_member(espace_id));
drop policy if exists sorties_lieux_depart_ajout on public.sorties_lieux_depart;
create policy sorties_lieux_depart_ajout on public.sorties_lieux_depart for insert to authenticated
  with check (public.sorties_is_editor(espace_id));
drop policy if exists sorties_preferences_depart_perso on public.sorties_preferences_depart;
create policy sorties_preferences_depart_perso on public.sorties_preferences_depart for all to authenticated
  using (user_id = (select auth.uid()) and public.sorties_is_member(espace_id))
  with check (user_id = (select auth.uid()) and public.sorties_is_member(espace_id));

insert into public.sorties_lieux_depart(espace_id, nom, ville, pays, par_defaut)
select id, 'Nyon', 'Nyon', 'Suisse', true from public.sorties_espaces
on conflict do nothing;

create or replace function public.sorties_initialiser_lieux_depart()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sorties_lieux_depart(espace_id, nom, ville, pays, par_defaut)
  values (new.id, 'Nyon', 'Nyon', 'Suisse', true);
  return new;
end;
$$;
revoke execute on function public.sorties_initialiser_lieux_depart() from public, anon, authenticated;
drop trigger if exists sorties_espaces_initialiser_lieux_depart on public.sorties_espaces;
create trigger sorties_espaces_initialiser_lieux_depart after insert on public.sorties_espaces
for each row execute function public.sorties_initialiser_lieux_depart();

insert into public.sorties_lieux_depart(espace_id, nom, ville, pays)
select e.id, lieux.nom, lieux.ville, lieux.pays
from public.sorties_espaces e
cross join (values ('La Saint Cantène', 'Saint-André-d’Olérargues', 'France'), ('Zermatt', 'Zermatt', 'Suisse')) lieux(nom, ville, pays)
where e.id = '51226a02-3bd2-4cf9-8ac4-22add26f1269'
on conflict do nothing;

alter table public.sorties_idees add column if not exists lieu_depart_id uuid;
alter table public.sorties_idees drop constraint if exists sorties_idees_lieu_depart_fk;
create index if not exists sorties_idees_lieu_depart_idx on public.sorties_idees(espace_id, lieu_depart_id);

-- Conserver maj_le et les imports en cours pendant ce rattachement technique.
alter table public.sorties_idees disable trigger sorties_idees_indexer;
update public.sorties_idees i set lieu_depart_id = l.id
from public.sorties_lieux_depart l where l.espace_id = i.espace_id and l.par_defaut and i.lieu_depart_id is null;
alter table public.sorties_idees enable trigger sorties_idees_indexer;

alter table public.sorties_idees add constraint sorties_idees_lieu_depart_fk
  foreign key (espace_id, lieu_depart_id) references public.sorties_lieux_depart(espace_id, id)
  deferrable initially deferred;

grant select (lieu_depart_id), insert (lieu_depart_id), update (lieu_depart_id)
  on public.sorties_idees to authenticated;

create or replace function public.sorties_assigner_lieu_depart()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.lieu_depart_id is null then
    select coalesce(
      (select p.lieu_id from public.sorties_preferences_depart p
       where p.espace_id = new.espace_id and p.user_id = new.ajoutee_par),
      (select l.id from public.sorties_lieux_depart l where l.espace_id = new.espace_id and l.par_defaut)
    ) into new.lieu_depart_id;
  end if;
  return new;
end;
$$;
drop trigger if exists sorties_idees_assigner_lieu_depart on public.sorties_idees;
create trigger sorties_idees_assigner_lieu_depart before insert or update of lieu_depart_id on public.sorties_idees
for each row execute function public.sorties_assigner_lieu_depart();

commit;
