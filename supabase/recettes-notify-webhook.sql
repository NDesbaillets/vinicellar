-- ARÔMES V&N · envoi des notifications : à chaque insertion dans l'outbox, appel de l'edge function recipe-notify.
-- Équivalent d'un webhook de base de données, sans secret dans le code : le secret partagé est lu dans le Vault
-- (secret « notify_secret », créé à part par select vault.create_secret(...), jamais dans une migration).
-- Rejouable. À appliquer après recettes-phase5.sql.

create extension if not exists pg_net with schema extensions;

create or replace function public.recipe_outbox_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  select decrypted_secret into s from vault.decrypted_secrets where name = 'notify_secret' limit 1;
  if s is null then
    raise warning 'recipe_outbox_notify : secret notify_secret absent du Vault, envoi différé';
    return null;
  end if;
  perform net.http_post(
    url := 'https://ysdkbkujgbkrpjishttp.supabase.co/functions/v1/recipe-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', s),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  return null;
end $$;
revoke execute on function public.recipe_outbox_notify() from anon, authenticated, public;

-- Un appel par instruction (et non par ligne) : la fonction traite tout ce qui attend dans l'outbox.
drop trigger if exists recipe_outbox_notify on public.recipe_notifications_outbox;
create trigger recipe_outbox_notify after insert on public.recipe_notifications_outbox
  for each statement execute function public.recipe_outbox_notify();
