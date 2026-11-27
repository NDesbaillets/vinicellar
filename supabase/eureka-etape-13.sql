-- À appliquer après les étapes précédentes. Prépare le créneau à la fin d’un nouvel import.
begin;

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
      saison_activite = coalesce(p_resultat->>'saison_activite', i.saison_activite),
      conditions_activite = coalesce(p_resultat->>'conditions_activite', i.conditions_activite),
      delai_reservation_jours = coalesce((p_resultat->>'delai_reservation_jours')::integer, i.delai_reservation_jours),
      meilleure_periode = case when jsonb_typeof(p_resultat->'meilleure_periode') = 'array'
          and jsonb_array_length(p_resultat->'meilleure_periode') > 0
        then array(select mois::smallint from jsonb_array_elements_text(p_resultat->'meilleure_periode') mois)
        else i.meilleure_periode end,
      parametres_creneau = case
        when i.parametres_creneau is null
          and public.sorties_parametres_creneau_valides(p_resultat->'parametres_creneau') is true
        then p_resultat->'parametres_creneau' else i.parametres_creneau end,
      brouillon_creneau = case
        when i.brouillon_creneau is null and i.parametres_creneau is null
          and public.sorties_parametres_creneau_valides(p_resultat->'parametres_creneau') is not true
        then nullif(p_resultat->'brouillon_creneau', 'null'::jsonb) else i.brouillon_creneau end,
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
