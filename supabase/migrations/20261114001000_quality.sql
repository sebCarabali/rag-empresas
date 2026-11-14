-- =====================================================================
-- Calidad de respuestas:
--   * message_feedback: 👍/👎 con comentario en el chat de la app
--   * widget_messages:  registro de las conversaciones del widget (+ su valoración)
--   * eval_cases / eval_runs / eval_results: pruebas automáticas de calidad
-- =====================================================================

-- ---------------------------------------------------------------------
-- Valoración de respuestas del chat de la app
-- ---------------------------------------------------------------------
create table public.message_feedback (
  message_id  uuid primary key references public.messages (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rating      smallint not null check (rating in (-1, 1)),
  comment     text check (char_length(comment) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index message_feedback_project_idx on public.message_feedback (project_id, created_at desc);

create trigger message_feedback_updated_at
  before update on public.message_feedback
  for each row execute function public.set_updated_at();

alter table public.message_feedback enable row level security;

-- Solo se valoran respuestas de conversaciones propias.
create policy "message_feedback_insert_own" on public.message_feedback
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_id
        and m.role = 'assistant'
        and c.user_id = (select auth.uid())
        and c.company_id = message_feedback.company_id
        and c.project_id = message_feedback.project_id
    )
  );

create policy "message_feedback_update_own" on public.message_feedback
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "message_feedback_delete_own" on public.message_feedback
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Cada usuario ve las suyas; owner/admin ven las de toda la empresa.
create policy "message_feedback_select" on public.message_feedback
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
  );

-- ---------------------------------------------------------------------
-- Conversaciones del widget (las escribe solo la API con service_role)
-- ---------------------------------------------------------------------
create table public.widget_messages (
  id                uuid primary key default gen_random_uuid(),
  chatbot_id        uuid not null references public.chatbots (id) on delete cascade,
  company_id        uuid not null references public.companies (id) on delete cascade,
  project_id        uuid not null references public.projects (id) on delete cascade,
  -- Identificador aleatorio de la sesión del visitante (lo genera el navegador).
  session_id        uuid not null,
  question          text not null,
  answer            text not null,
  model_info        jsonb,
  cached            boolean not null default false,
  rating            smallint check (rating in (-1, 1)),
  feedback_comment  text check (char_length(feedback_comment) <= 1000),
  feedback_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index widget_messages_project_idx on public.widget_messages (project_id, created_at desc);
create index widget_messages_session_idx on public.widget_messages (session_id, created_at);

alter table public.widget_messages enable row level security;

-- Lectura: owner/admin/editor de la empresa. Sin políticas de escritura (solo service_role).
create policy "widget_messages_select_staff" on public.widget_messages
  for select to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[]));

-- ---------------------------------------------------------------------
-- Pruebas automáticas de calidad
-- ---------------------------------------------------------------------
create table public.eval_cases (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  project_id        uuid not null references public.projects (id) on delete cascade,
  question          text not null check (char_length(question) between 1 and 1000),
  -- La respuesta debe contener todos estos textos (sin distinguir mayúsculas ni tildes).
  must_include      text[] not null default '{}' check (cardinality(must_include) <= 20),
  -- Y ninguno de estos.
  must_not_include  text[] not null default '{}' check (cardinality(must_not_include) <= 20),
  notes             text check (char_length(notes) <= 1000),
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index eval_cases_project_idx on public.eval_cases (project_id, created_at);

create trigger eval_cases_updated_at
  before update on public.eval_cases
  for each row execute function public.set_updated_at();

create table public.eval_runs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  total        integer not null default 0,
  passed       integer not null default 0,
  failed       integer not null default 0,
  error        text,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index eval_runs_project_idx on public.eval_runs (project_id, created_at desc);

create table public.eval_results (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.eval_runs (id) on delete cascade,
  company_id        uuid not null references public.companies (id) on delete cascade,
  case_id           uuid references public.eval_cases (id) on delete set null,
  question          text not null,
  answer            text not null default '',
  passed            boolean not null,
  missing           text[] not null default '{}',
  forbidden         text[] not null default '{}',
  model_info        jsonb,
  duration_ms       integer,
  error             text,
  created_at        timestamptz not null default now(),
  unique (run_id, case_id)
);

alter table public.eval_cases   enable row level security;
alter table public.eval_runs    enable row level security;
alter table public.eval_results enable row level security;

create policy "eval_cases_select_members" on public.eval_cases
  for select to authenticated using (public.is_company_member(company_id));

create policy "eval_cases_write_editors" on public.eval_cases
  for all to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[]))
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[])
    and exists (select 1 from public.projects p where p.id = project_id and p.company_id = eval_cases.company_id)
  );

create policy "eval_runs_select_members" on public.eval_runs
  for select to authenticated using (public.is_company_member(company_id));

-- Las ejecuciones se crean desde la API con el usuario; el worker las actualiza con service_role.
create policy "eval_runs_insert_editors" on public.eval_runs
  for insert to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[])
    and exists (select 1 from public.projects p where p.id = project_id and p.company_id = eval_runs.company_id)
  );

create policy "eval_runs_delete_editors" on public.eval_runs
  for delete to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[]));

create policy "eval_results_select_members" on public.eval_results
  for select to authenticated using (public.is_company_member(company_id));
