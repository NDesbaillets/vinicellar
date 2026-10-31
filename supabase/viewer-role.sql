-- Vinicellar · partage en lecture seule : rôle « viewer » (voit tout, ne modifie rien).
-- À exécuter une fois dans Supabase > SQL Editor, après wishlists.sql.

alter table public.collection_members drop constraint if exists collection_members_role_check;
alter table public.collection_members add constraint collection_members_role_check check (role in ('owner','member','viewer'));
alter table public.collection_invites add column if not exists role text not null default 'member';
alter table public.collection_invites drop constraint if exists collection_invites_role_check;
alter table public.collection_invites add constraint collection_invites_role_check check (role in ('member','viewer'));

-- Peut modifier : propriétaire ou membre « accès complet ».
create or replace function public.can_edit(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from collection_members where collection_id = c and user_id = auth.uid() and role in ('owner','member'))
$$;
revoke execute on function public.can_edit(uuid) from anon, public;
grant execute on function public.can_edit(uuid) to authenticated;

-- Lecture pour tous les membres, écriture réservée à ceux qui peuvent modifier.
do $$
declare t text;
begin
  foreach t in array array['locations','items','stock','tastings','drafts','wishlists','wishlist_items'] loop
    execute format('drop policy if exists "members" on public.%I', t);
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('drop policy if exists "editors insert" on public.%I', t);
    execute format('drop policy if exists "editors update" on public.%I', t);
    execute format('drop policy if exists "editors delete" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(collection_id))', t);
    execute format('create policy "editors insert" on public.%I for insert to authenticated with check (public.can_edit(collection_id))', t);
    execute format('create policy "editors update" on public.%I for update to authenticated using (public.can_edit(collection_id)) with check (public.can_edit(collection_id))', t);
    execute format('create policy "editors delete" on public.%I for delete to authenticated using (public.can_edit(collection_id))', t);
  end loop;
end $$;

-- Le propriétaire change le niveau d'accès d'un membre (complet ↔ lecture seule).
drop policy if exists "owner sets role" on public.collection_members;
create policy "owner sets role" on public.collection_members for update to authenticated
  using (role <> 'owner' and public.is_owner(collection_id))
  with check (role in ('member','viewer') and public.is_owner(collection_id));

-- L'invitation porte le niveau d'accès choisi.
create or replace function public.accept_invite(p_invite uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; r text;
begin
  update collection_invites set accepted_at = now()
   where id = p_invite and accepted_at is null and email = lower(coalesce(auth.jwt()->>'email', ''))
  returning collection_id, role into c, r;
  if c is null then raise exception 'invitation introuvable'; end if;
  insert into collection_members (collection_id, user_id, role) values (c, auth.uid(), coalesce(r, 'member'))
  on conflict do nothing;
  return c;
end $$;

drop function if exists public.my_invites();
create or replace function public.my_invites()
returns table (id uuid, collection_id uuid, collection_name text, invited_by_name text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.collection_id, c.name, p.full_name, i.role, i.created_at
  from collection_invites i join collections c on c.id = i.collection_id left join profiles p on p.id = i.invited_by
  where i.accepted_at is null and i.email = lower(coalesce(auth.jwt()->>'email', ''))
    and not public.is_member(i.collection_id)
$$;
revoke execute on function public.my_invites() from anon, public;
grant execute on function public.my_invites() to authenticated;
