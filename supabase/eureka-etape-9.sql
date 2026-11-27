-- Enregistrer les champs partiels de planification sans autoriser leur confirmation.
begin;

alter table public.sorties_idees add column if not exists brouillon_creneau jsonb;

grant select (brouillon_creneau), insert (brouillon_creneau),
  update (brouillon_creneau) on public.sorties_idees to authenticated;

commit;
