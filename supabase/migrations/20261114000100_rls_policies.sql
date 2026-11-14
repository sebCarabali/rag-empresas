-- =====================================================================
-- Row Level Security: cada usuario solo ve los datos de sus empresas
-- La API usa el JWT del usuario, así que estas políticas son la barrera
-- real de aislamiento entre empresas. El worker usa service_role.
-- =====================================================================

alter table public.companies        enable row level security;
alter table public.company_members  enable row level security;
alter table public.projects         enable row level security;
alter table public.documents        enable row level security;
alter table public.document_chunks  enable row level security;
alter table public.conversations    enable row level security;
alter table public.messages         enable row level security;

-- ---------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------
create policy "companies_select_members" on public.companies
  for select to authenticated
  using (public.is_company_member(id));

create policy "companies_insert_self" on public.companies
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "companies_update_admins" on public.companies
  for update to authenticated
  using (public.has_company_role(id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_company_role(id, array['owner', 'admin']::public.member_role[]));

create policy "companies_delete_owner" on public.companies
  for delete to authenticated
  using (public.has_company_role(id, array['owner']::public.member_role[]));

-- ---------------------------------------------------------------------
-- company_members
-- ---------------------------------------------------------------------
create policy "members_select_same_company" on public.company_members
  for select to authenticated
  using (public.is_company_member(company_id));

create policy "members_insert_admins" on public.company_members
  for insert to authenticated
  with check (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy "members_update_admins" on public.company_members
  for update to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy "members_delete_admins" on public.company_members
  for delete to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

-- ---------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------
create policy "projects_select_members" on public.projects
  for select to authenticated
  using (public.is_company_member(company_id));

create policy "projects_insert_admins" on public.projects
  for insert to authenticated
  with check (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy "projects_update_admins" on public.projects
  for update to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy "projects_delete_admins" on public.projects
  for delete to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

-- ---------------------------------------------------------------------
-- documents (lectura: miembros; escritura: editor o superior)
-- Las transiciones de estado del worker se hacen con service_role.
-- ---------------------------------------------------------------------
create policy "documents_select_members" on public.documents
  for select to authenticated
  using (public.is_company_member(company_id));

create policy "documents_insert_editors" on public.documents
  for insert to authenticated
  with check (public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[]));

create policy "documents_delete_editors" on public.documents
  for delete to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[]));

-- ---------------------------------------------------------------------
-- document_chunks (solo lectura para usuarios; escribe el worker)
-- ---------------------------------------------------------------------
create policy "chunks_select_members" on public.document_chunks
  for select to authenticated
  using (public.is_company_member(company_id));

-- ---------------------------------------------------------------------
-- conversations (privadas de cada usuario dentro de su empresa)
-- ---------------------------------------------------------------------
create policy "conversations_select_own" on public.conversations
  for select to authenticated
  using (user_id = (select auth.uid()) and public.is_company_member(company_id));

create policy "conversations_insert_own" on public.conversations
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_company_member(company_id));

create policy "conversations_update_own" on public.conversations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "conversations_delete_own" on public.conversations
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- messages (a través de la conversación)
-- ---------------------------------------------------------------------
create policy "messages_select_own" on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));

create policy "messages_insert_own" on public.messages
  for insert to authenticated
  with check (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));
