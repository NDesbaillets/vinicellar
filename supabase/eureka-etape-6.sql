-- Répétition annuelle : un créneau par saison est un objectif de planification.
begin;

alter table public.sorties_idees
  add column if not exists saison_debut_mois smallint,
  add column if not exists saison_fin_mois smallint;

alter table public.sorties_idees
  drop constraint if exists sorties_idees_saison_annuelle_check,
  add constraint sorties_idees_saison_annuelle_check check (
    (saison_debut_mois is null and saison_fin_mois is null)
    or (
      saison_debut_mois is not null and saison_fin_mois is not null
      and saison_debut_mois between 1 and 12 and saison_fin_mois between 1 and 12
      and recurrence_mois is null
    )
  );

-- Les politiques existantes continuent de réserver les écritures aux éditeurs.
grant insert (saison_debut_mois, saison_fin_mois),
  update (saison_debut_mois, saison_fin_mois) on public.sorties_idees to authenticated;

commit;
