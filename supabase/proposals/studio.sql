-- PROPOSITION À VALIDER. Ne pas exécuter sur un projet sans autorisation.
-- Additif, après les scripts existants (sharing, viewer-role, photos, wishlists).
begin;
create schema if not exists studio_private;
revoke all on schema studio_private from public;
grant usage on schema studio_private to authenticated, service_role;

create table public.studio_jobs (
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.items on delete cascade,
 collection_id uuid not null references public.collections on delete cascade,
 requested_by uuid references auth.users on delete set null,
 request_key uuid not null,
 fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
 pipeline text not null default 'photographic-v1' check (pipeline = 'photographic-v1'),
 outputs text[] not null check (cardinality(outputs) between 1 and 2 and outputs <@ array['label','bottle']::text[]),
 sources jsonb not null, source_hashes jsonb not null, settings jsonb not null,
 status text not null default 'queued' check (status in ('queued','processing','ready','failed')),
 stage text not null default 'queued', errors jsonb not null default '{}',
 attempts int not null default 0, lease_token uuid, lease_until timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(requested_by, request_key), unique(id,item_id,collection_id)
);
create index studio_jobs_queue on public.studio_jobs(created_at) where status in ('queued','processing');
create index studio_jobs_cache on public.studio_jobs(collection_id,item_id,fingerprint,created_at desc);
create index studio_jobs_quota on public.studio_jobs(requested_by,created_at);
create unique index studio_jobs_inflight on public.studio_jobs(collection_id,item_id,fingerprint) where status in ('queued','processing');

create table public.studio_assets (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null, item_id uuid not null, collection_id uuid not null,
 kind text not null check (kind in ('label','bottle')),
 candidate_path text not null unique, approved_path text unique,
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 width int not null check (width between 100 and 4096), height int not null check (height between 100 and 4096),
 has_alpha boolean not null,
 provenance text not null check (provenance in ('label_restored','bottle_cutout','bottle_reconstructed')),
 warnings text[] not null default '{}',
 decision text not null default 'pending' check (decision in ('pending','approved','rejected')),
 active boolean not null default false, reviewed_by uuid references auth.users on delete set null,
 reviewed_at timestamptz, created_at timestamptz not null default now(),
 foreign key(job_id,item_id,collection_id) references public.studio_jobs(id,item_id,collection_id) on delete cascade,
 unique(job_id,kind),
 check (not active or decision = 'approved' and approved_path is not null),
 check (kind <> 'bottle' or has_alpha),
 check (kind='label' and provenance='label_restored' or kind='bottle' and provenance in ('bottle_cutout','bottle_reconstructed'))
);
create unique index studio_assets_active on public.studio_assets(item_id,kind) where active;
create index studio_assets_collection on public.studio_assets(collection_id);
alter table public.studio_jobs enable row level security;
alter table public.studio_assets enable row level security;
revoke all on public.studio_jobs, public.studio_assets from anon, authenticated;
grant select on public.studio_jobs, public.studio_assets to authenticated;
grant all on public.studio_jobs, public.studio_assets to service_role;
create policy "studio jobs editors read" on public.studio_jobs for select to authenticated using (public.can_edit(collection_id));
create policy "studio assets members read approved editors candidates" on public.studio_assets for select to authenticated
 using (public.is_member(collection_id) and (decision = 'approved' or public.can_edit(collection_id)));

-- Nouveaux buckets privés, immuables côté navigateur. Aucun changement du bucket labels.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('studio-candidates','studio-candidates',false,8388608,array['image/png']),
 ('studio-approved','studio-approved',false,8388608,array['image/png']);
create policy "studio candidates editors read" on storage.objects for select to authenticated using (
 bucket_id = 'studio-candidates' and exists(select 1 from public.studio_assets a where a.candidate_path = storage.objects.name and public.can_edit(a.collection_id)));
create policy "studio approved members read" on storage.objects for select to authenticated using (
 bucket_id = 'studio-approved' and exists(select 1 from public.studio_assets a where a.approved_path = storage.objects.name and a.decision = 'approved' and public.is_member(a.collection_id)));

-- Les RPC techniques sont réservées au serveur. Aucune SECURITY DEFINER exposée.
create function public.studio_enqueue(p_user uuid,p_item uuid,p_request uuid,p_fingerprint text,p_outputs text[],p_sources jsonb,p_hashes jsonb,p_settings jsonb,p_force boolean default false)
returns public.studio_jobs language plpgsql security invoker set search_path = '' as $$
declare c uuid; j public.studio_jobs;
begin
 select collection_id into c from public.items where id=p_item;
 if c is null or not exists(select 1 from public.collection_members where collection_id=c and user_id=p_user and role in ('owner','member')) then raise exception 'forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||p_item::text||p_fingerprint,0));
 select * into j from public.studio_jobs where requested_by=p_user and request_key=p_request;
 if j.id is not null then
   if j.fingerprint <> p_fingerprint then raise exception 'request key conflict'; end if;
   return j;
 end if;
 select * into j from public.studio_jobs where collection_id=c and item_id=p_item and fingerprint=p_fingerprint
 and (status in ('queued','processing') or not p_force and status='ready') order by created_at desc limit 1;
 if j.id is not null then return j; end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,3));
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1));
 if (select count(*) from public.studio_jobs where requested_by=p_user and created_at>now()-interval '24 hours') >=20
 or (select count(*) from public.studio_jobs where collection_id=c and created_at>now()-interval '24 hours') >=100 then raise exception 'quota'; end if;
 insert into public.studio_jobs(item_id,collection_id,requested_by,request_key,fingerprint,outputs,sources,source_hashes,settings)
 values(p_item,c,p_user,p_request,p_fingerprint,p_outputs,p_sources,p_hashes,p_settings) returning * into j;
 return j;
end $$;

create function public.studio_claim_job() returns setof public.studio_jobs language plpgsql security invoker set search_path = '' as $$
declare j public.studio_jobs;
begin
 update public.studio_jobs set status='failed',stage='failed',errors=jsonb_build_object('system','Traitement interrompu après trois tentatives.'),updated_at=now()
 where status='processing' and lease_until<now() and attempts>=3;
 select * into j from public.studio_jobs where (status='queued' or status='processing' and lease_until<now()) and attempts<3 order by created_at limit 1 for update skip locked;
 if j.id is null then return; end if;
 -- Revérifier les droits avant de lire des photos après une attente en file.
 if not exists(select 1 from public.collection_members where collection_id=j.collection_id and user_id=j.requested_by and role in ('owner','member')) then
   update public.studio_jobs set status='failed',stage='failed',errors='{"system":"Accès révoqué."}' where id=j.id; return;
 end if;
 return query update public.studio_jobs set status='processing',stage='preparing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where id=j.id returning *;
end $$;

create function public.studio_progress(p_job uuid,p_lease uuid,p_stage text) returns void language plpgsql security invoker set search_path = '' as $$
begin
 if p_stage not in ('label','bottle','checks') then raise exception 'stage'; end if;
 update public.studio_jobs set stage=p_stage,updated_at=now() where id=p_job and status='processing' and lease_token=p_lease and lease_until>now();
 if not found then raise exception 'expired lease'; end if;
end $$;

create function public.studio_finish_job(p_job uuid,p_lease uuid,p_assets jsonb,p_errors jsonb) returns void language plpgsql security invoker set search_path = '' as $$
declare j public.studio_jobs; a jsonb; expected text;
begin
 select * into j from public.studio_jobs where id=p_job for update;
 if j.id is null or j.status<>'processing' or j.lease_token is distinct from p_lease or j.lease_until<now() then raise exception 'expired lease'; end if;
 if jsonb_typeof(p_assets)<>'array' or jsonb_array_length(p_assets)>2 then raise exception 'assets'; end if;
 for a in select value from jsonb_array_elements(p_assets) loop
   expected=j.collection_id::text||'/'||j.item_id::text||'/'||j.id::text||'/'||p_lease::text||'/'||(a->>'kind')||'.png';
   if not (a->>'kind'=any(j.outputs)) or a->>'candidate_path' is distinct from expected then raise exception 'candidate path'; end if;
   insert into public.studio_assets(job_id,item_id,collection_id,kind,candidate_path,sha256,width,height,has_alpha,provenance,warnings)
   values(j.id,j.item_id,j.collection_id,a->>'kind',expected,a->>'sha256',(a->>'width')::int,(a->>'height')::int,(a->>'has_alpha')::boolean,a->>'provenance',array(select jsonb_array_elements_text(coalesce(a->'warnings','[]'))));
 end loop;
 update public.studio_jobs set status=case when jsonb_array_length(p_assets)>0 then 'ready' else 'failed' end,stage='done',errors=p_errors,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
end $$;

create function public.studio_decide_asset(p_user uuid,p_asset uuid,p_decision text,p_path text default null)
returns public.studio_assets language plpgsql security invoker set search_path = '' as $$
declare a public.studio_assets; it public.items; j public.studio_jobs; ref text;
begin
 -- Même ordre de verrous pour toutes les décisions d'une fiche.
 select i.* into it from public.items i join public.studio_assets x on x.item_id=i.id where x.id=p_asset for update of i;
 select * into a from public.studio_assets where id=p_asset for update;
 if a.id is null or not exists(select 1 from public.collection_members where collection_id=a.collection_id and user_id=p_user and role in ('owner','member')) then raise exception 'forbidden'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'decision'; end if;
 if a.decision=p_decision then return a; end if;
 if a.decision<>'pending' then raise exception 'decision conflict'; end if;
 select * into j from public.studio_jobs where id=a.job_id;
 if j.status<>'ready' then raise exception 'job not ready'; end if;
 for ref in select value from jsonb_each_text(j.sources) loop
   if not (ref=any(array_remove(array[it.label_path,it.label_back_path,it.bottle_path]||it.photo_paths,null))) then raise exception 'source detached'; end if;
 end loop;
 if p_decision='approved' then
   if p_path is distinct from a.collection_id::text||'/'||a.item_id::text||'/'||a.id::text||'.png' then raise exception 'approved path'; end if;
   if not exists(select 1 from storage.objects where bucket_id='studio-approved' and name=p_path) then raise exception 'file missing'; end if;
   update public.studio_assets set active=false where item_id=a.item_id and kind=a.kind and active;
 end if;
 update public.studio_assets set decision=p_decision,active=(p_decision='approved'),approved_path=case when p_decision='approved' then p_path else null end,reviewed_by=p_user,reviewed_at=now() where id=a.id returning * into a;
 return a;
end $$;

-- Reçus privés : une sauvegarde fiche + stock + envies en une transaction, rejouable.
create table studio_private.item_save_receipts (
 user_id uuid not null references auth.users on delete cascade, request_key uuid not null,
 item_id uuid not null references public.items on delete cascade, payload jsonb not null,
 created_at timestamptz not null default now(), primary key(user_id,request_key)
);
alter table studio_private.item_save_receipts enable row level security;
grant select,insert on studio_private.item_save_receipts to authenticated;
create policy "own save receipt" on studio_private.item_save_receipts for select to authenticated using(user_id=(select auth.uid()));
create policy "own save receipt insert" on studio_private.item_save_receipts for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.items i where i.id=item_id and public.can_edit(i.collection_id)));

create function public.studio_save_item(p_request uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path = '' as $$
declare u uuid=auth.uid(); c uuid; ic uuid; result uuid; old studio_private.item_save_receipts; rowdata jsonb; safe jsonb;
 target uuid=nullif(p_payload->>'target','')::uuid; loc uuid=nullif(p_payload->>'location','')::uuid; wl uuid=nullif(p_payload->>'wishlist','')::uuid;
 qty int=coalesce((p_payload->>'qty')::int,0); photos text[]=array(select jsonb_array_elements_text(coalesce(p_payload->'photos','[]')));
begin
 if u is null or p_request is null or qty<0 or qty>999 then raise exception 'invalid save'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request::text,2));
 select * into old from studio_private.item_save_receipts where user_id=u and request_key=p_request;
 if old.item_id is not null then
   if old.payload<>p_payload then raise exception 'request changed'; end if;
   return old.item_id;
 end if;
 if loc is not null then select collection_id into c from public.locations where id=loc; end if;
 if wl is not null then select collection_id into c from public.wishlists where id=wl; end if;
 c=coalesce(c,public.my_collection());
 if not public.can_edit(c) then raise exception 'forbidden'; end if;
 if target is not null then
   select collection_id into ic from public.items where id=target for update;
   if ic is distinct from c then raise exception 'wrong collection'; end if;
   result=target;
   update public.items set label_path=coalesce(label_path,photos[1]),photo_paths=array(select distinct x from unnest(photo_paths||photos) x where x is not null and x is distinct from coalesce(label_path,photos[1]) and x is distinct from label_back_path) where id=target;
 else
   select coalesce(jsonb_object_agg(key,value),'{}') into safe from jsonb_each(coalesce(p_payload->'data','{}'))
   where key=any(array['name','category','style','producer','producer_url','vintage','country','region','appellation','grapes','abv','volume_cl','description','vinification','terroir','vintage_notes','pairings','serving_temp_min','serving_temp_max','drink_from','drink_to','peak_from','peak_to','aging_potential_years','window_source','avg_score','avg_score_scale','avg_score_source','market_price','market_currency','price_source','details','notes','purchase_price','purchase_currency','purchase_year','purchase_place']);
   result=gen_random_uuid();
   rowdata=jsonb_build_object('category','wine','volume_cl',75,'market_currency','CHF','purchase_currency','CHF','grapes','[]'::jsonb,'details','{}'::jsonb,'sources',coalesce(p_payload->'sources','[]'),'photo_paths',to_jsonb(coalesce(photos[3:cardinality(photos)],'{}')),'pairings','[]'::jsonb)
     ||safe||jsonb_build_object('id',result,'collection_id',c,'user_id',u,'created_at',now(),'updated_at',now(),'label_path',photos[1],'label_back_path',photos[2],'bottle_path',p_payload->>'bottle_path','bottle_image_url',p_payload->>'bottle_image_url','ai_enriched_at',p_payload->>'ai_enriched_at');
   insert into public.items select (jsonb_populate_record(null::public.items,rowdata)).*;
 end if;
 if qty>0 and wl is null then
   if loc is null then raise exception 'location required'; end if;
   perform public.adjust_stock(result,loc,qty,nullif(p_payload->>'bin',''));
 end if;
 if wl is not null then
   insert into public.wishlist_items(wishlist_id,item_id,qty_wanted) values(wl,result,nullif(qty,0)) on conflict(wishlist_id,item_id) do nothing;
 end if;
 if nullif(p_payload->>'draft_id','') is not null then
   delete from public.drafts where id=(p_payload->>'draft_id')::uuid and public.can_edit(collection_id);
 end if;
 insert into studio_private.item_save_receipts(user_id,request_key,item_id,payload) values(u,p_request,result,p_payload);
 return result;
end $$;

revoke all on function public.studio_enqueue(uuid,uuid,uuid,text,text[],jsonb,jsonb,jsonb,boolean),public.studio_claim_job(),public.studio_progress(uuid,uuid,text),public.studio_finish_job(uuid,uuid,jsonb,jsonb),public.studio_decide_asset(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.studio_enqueue(uuid,uuid,uuid,text,text[],jsonb,jsonb,jsonb,boolean),public.studio_claim_job(),public.studio_progress(uuid,uuid,text),public.studio_finish_job(uuid,uuid,jsonb,jsonb),public.studio_decide_asset(uuid,uuid,text,text) to service_role;
revoke all on function public.studio_save_item(uuid,jsonb) from public,anon;
grant execute on function public.studio_save_item(uuid,jsonb) to authenticated;
-- Attacher une nouvelle photographie, sans supprimer ni remplacer un original.
create function public.studio_attach_source(p_item uuid,p_path text) returns void language plpgsql security invoker set search_path = '' as $$
declare c uuid;
begin
 select collection_id into c from public.items where id=p_item for update;
 if c is null or not public.can_edit(c) or split_part(p_path,'/',1) is distinct from auth.uid()::text
 or p_path like '%..%' or not exists(select 1 from storage.objects where bucket_id='labels' and name=p_path) then raise exception 'forbidden'; end if;
 update public.items set photo_paths=array(select distinct x from unnest(coalesce(photo_paths,'{}')||array[p_path]) x) where id=p_item;
end $$;
revoke all on function public.studio_attach_source(uuid,text) from public,anon;
grant execute on function public.studio_attach_source(uuid,text) to authenticated;
commit;
