-- Saison et conditions d’une activité. À appliquer après l’étape 10.
begin;

alter table public.sorties_idees
  add column if not exists saison_activite text
    check (saison_activite in ('hiver', 'printemps', 'ete', 'automne', 'toute_annee')),
  add column if not exists conditions_activite text
    check (char_length(conditions_activite) <= 240);

grant select (saison_activite, conditions_activite), insert (saison_activite, conditions_activite),
  update (saison_activite, conditions_activite) on public.sorties_idees to authenticated;

commit;
