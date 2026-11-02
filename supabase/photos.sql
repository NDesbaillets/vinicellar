-- Vinicellar · photos ajoutées après coup sur une fiche, et choix de la photo affichée en vignette.
-- À exécuter une fois dans Supabase > SQL Editor, après viewer-role.sql.

alter table public.items add column if not exists photo_paths text[] not null default '{}';
alter table public.items add column if not exists cover_path text;

-- Les photos supplémentaires sont visibles (et supprimables) par les membres, comme les autres.
drop policy if exists "labels read" on storage.objects;
create policy "labels read" on storage.objects for select to authenticated using (
  bucket_id = 'labels' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.items i where i.label_path = storage.objects.name or i.bottle_path = storage.objects.name
               or i.label_back_path = storage.objects.name or storage.objects.name = any (i.photo_paths))
    or exists (select 1 from public.drafts d where storage.objects.name = any (d.photo_paths) or d.bottle_path = storage.objects.name)
  ));
drop policy if exists "labels delete" on storage.objects;
create policy "labels delete" on storage.objects for delete to authenticated using (
  bucket_id = 'labels' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.items i where public.can_edit(i.collection_id) and (i.label_path = storage.objects.name
               or i.bottle_path = storage.objects.name or i.label_back_path = storage.objects.name or storage.objects.name = any (i.photo_paths)))
  ));
