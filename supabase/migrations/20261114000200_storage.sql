-- =====================================================================
-- Storage: bucket privado "documents"
-- Ruta de cada archivo: {company_id}/{project_id}/{document_id}/{nombre}
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800) -- 50 MB
on conflict (id) do nothing;

create policy "documents_bucket_select_members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

create policy "documents_bucket_insert_editors" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.has_company_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin', 'editor']::public.member_role[]
    )
  );

create policy "documents_bucket_delete_editors" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and public.has_company_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin', 'editor']::public.member_role[]
    )
  );
