-- Délai minimal de réservation, distinct du préavis de rappel.
begin;

alter table public.sorties_idees
  add column if not exists delai_reservation_jours integer
    check (delai_reservation_jours between 0 and 365);

grant select (delai_reservation_jours), insert (delai_reservation_jours),
  update (delai_reservation_jours) on public.sorties_idees to authenticated;

commit;
