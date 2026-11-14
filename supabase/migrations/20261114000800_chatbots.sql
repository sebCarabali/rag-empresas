-- =====================================================================
-- Chatbot personalizable por proyecto y widget público para el sitio web
-- de la empresa.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create table public.chatbots (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  project_id            uuid not null unique references public.projects (id) on delete cascade,

  -- Personalización (app y widget)
  name                  text not null default 'Asistente' check (char_length(name) between 1 and 60),
  welcome_message       text check (char_length(welcome_message) <= 500),
  instructions          text check (char_length(instructions) <= 2000),
  suggested_questions   text[] not null default '{}' check (cardinality(suggested_questions) <= 6),
  primary_color         text not null default '#0f172a' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  avatar_url            text check (avatar_url is null or avatar_url ~ '^https://'),
  language              text not null default 'auto' check (language in ('auto', 'es', 'en', 'pt')),

  -- Widget público
  widget_enabled        boolean not null default false,
  -- Clave pública que va en el <script> del sitio (no es secreta).
  public_key            text not null unique
                          default 'bot_' || encode(extensions.gen_random_bytes(16), 'hex'),
  -- Sitios autorizados a insertar el widget, p. ej. {'https://www.empresa.com'}.
  allowed_origins       text[] not null default '{}' check (cardinality(allowed_origins) <= 10),
  daily_message_limit   integer not null default 300 check (daily_message_limit between 1 and 100000),
  widget_show_sources   boolean not null default false,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger chatbots_updated_at
  before update on public.chatbots
  for each row execute function public.set_updated_at();

alter table public.chatbots enable row level security;

create policy "chatbots_select_members" on public.chatbots
  for select to authenticated
  using (public.is_company_member(company_id));

create policy "chatbots_insert_admins" on public.chatbots
  for insert to authenticated
  with check (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy "chatbots_update_admins" on public.chatbots
  for update to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

-- company_id del chatbot debe coincidir con el de su proyecto.
create or replace function public.chatbots_check_company()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.projects p where p.id = new.project_id and p.company_id = new.company_id
  ) then
    raise exception 'El proyecto no pertenece a la empresa indicada';
  end if;
  return new;
end;
$$;

create trigger chatbots_company_consistency
  before insert or update of project_id, company_id on public.chatbots
  for each row execute function public.chatbots_check_company();

-- ---------------------------------------------------------------------
-- Uso diario del widget (control de costo). Solo lo toca la API.
-- ---------------------------------------------------------------------
create table public.widget_usage (
  chatbot_id  uuid not null references public.chatbots (id) on delete cascade,
  day         date not null default current_date,
  messages    integer not null default 0,
  primary key (chatbot_id, day)
);

alter table public.widget_usage enable row level security;

create policy "widget_usage_select_members" on public.widget_usage
  for select to authenticated
  using (exists (
    select 1 from public.chatbots b where b.id = chatbot_id and public.is_company_member(b.company_id)
  ));

-- Suma un mensaje al día actual y devuelve el total (atómico).
create or replace function public.widget_register_message(p_chatbot_id uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.widget_usage (chatbot_id, day, messages)
  values (p_chatbot_id, current_date, 1)
  on conflict (chatbot_id, day) do update set messages = public.widget_usage.messages + 1
  returning messages;
$$;

revoke execute on function public.widget_register_message(uuid) from public, anon, authenticated;
grant execute on function public.widget_register_message(uuid) to service_role;

-- El widget consulta con service_role (visitantes anónimos), siempre acotado al proyecto del chatbot.
grant execute on function public.match_document_chunks(uuid, extensions.vector, text, int, float, float, int) to service_role;
grant execute on function public.search_catalog(uuid, jsonb, text, text, int, text) to service_role;
grant execute on function public.catalog_fields(uuid) to service_role;
