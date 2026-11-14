-- =====================================================================
-- Esquema base: empresas, miembros, proyectos, documentos, chunks y chat
-- =====================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'editor', 'viewer');

create type public.document_status as enum (
  'uploading',   -- registro creado, el archivo aún se está subiendo
  'pending',     -- en la cola, esperando al worker
  'processing',  -- el worker lo está procesando
  'ready',       -- listo para consultar
  'failed'       -- error (ver documents.error)
);

-- ---------------------------------------------------------------------
-- Utilidad: updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  created_by  uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Miembros de cada empresa
-- ---------------------------------------------------------------------
create table public.company_members (
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.member_role not null default 'viewer',
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index company_members_user_idx on public.company_members (user_id);

-- Quien crea la empresa queda como owner.
create or replace function public.add_company_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_members (company_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger companies_add_owner
  after insert on public.companies
  for each row execute function public.add_company_owner();

-- Crear empresa vía RPC: un INSERT ... RETURNING directo fallaría porque la
-- política SELECT se evalúa antes de que el trigger agregue al owner.
create or replace function public.create_company(p_name text)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  insert into public.companies (name, created_by)
  values (trim(p_name), (select auth.uid()))
  returning * into v_company;

  return v_company;
end;
$$;

revoke execute on function public.create_company(text) from public, anon;
grant execute on function public.create_company(text) to authenticated;

-- ---------------------------------------------------------------------
-- Helpers de autorización (security definer para evitar recursión en RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_company_role(
  p_company_id uuid,
  p_roles public.member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

-- ---------------------------------------------------------------------
-- Proyectos
-- ---------------------------------------------------------------------
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 120),
  description  text,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index projects_company_idx on public.projects (company_id);

create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Documentos
-- ---------------------------------------------------------------------
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,
  name          text not null,
  storage_path  text not null unique,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  status        public.document_status not null default 'uploading',
  error         text,
  chunk_count   integer not null default 0,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index documents_project_idx on public.documents (project_id);

create trigger documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- company_id del documento debe coincidir con el de su proyecto.
create or replace function public.documents_check_company()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.company_id = new.company_id
  ) then
    raise exception 'El proyecto no pertenece a la empresa indicada';
  end if;
  return new;
end;
$$;

create trigger documents_company_consistency
  before insert or update of project_id, company_id on public.documents
  for each row execute function public.documents_check_company();

-- ---------------------------------------------------------------------
-- Fragmentos (chunks) con embedding y texto para búsqueda híbrida
-- multilingual-e5-small => 384 dimensiones
-- ---------------------------------------------------------------------
create table public.document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  chunk_index  integer not null,
  content      text not null,
  metadata     jsonb not null default '{}'::jsonb,
  embedding    extensions.vector(384) not null,
  fts          tsvector generated always as (to_tsvector('spanish', content)) stored,
  created_at   timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index document_chunks_project_idx on public.document_chunks (project_id);
create index document_chunks_fts_idx on public.document_chunks using gin (fts);
create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------
-- Conversaciones y mensajes
-- ---------------------------------------------------------------------
create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null default 'Nueva conversación',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index conversations_project_user_idx on public.conversations (project_id, user_id);

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  sources          jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);
