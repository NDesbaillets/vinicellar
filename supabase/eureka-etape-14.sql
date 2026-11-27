-- Inclut Tavily dans le même plafond mensuel et le journal IA.
begin;

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
  if p_kind not in ('sorties-apify', 'sorties-claude', 'sorties-gemini', 'sorties-tavily')
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
