-- =====================================================================
-- Claves secretas de API por proyecto y widget protegido con token.
--   * api_keys: la API genera la clave (sk_live_…), la muestra una sola vez y
--     guarda solo su hash SHA-256. La usa el servidor de la empresa.
--   * chatbots.widget_auth: 'public' (clave pública + dominios autorizados) o
--     'token' (además exige un token temporal firmado que emite el servidor de
--     la empresa con su clave secreta).
-- =====================================================================

alter table public.chatbots
  add column widget_auth text not null default 'public' check (widget_auth in ('public', 'token'));

create table public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  -- Primeros caracteres para reconocerla en la lista (sk_live_ab12…).
  prefix        text not null,
  last4         text not null,
  key_hash      text not null unique,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

create index api_keys_project_idx on public.api_keys (project_id, created_at desc);
create index api_keys_company_idx on public.api_keys (company_id);

alter table public.api_keys enable row level security;

-- Solo owner/admin ven la lista; nadie lee el hash desde el navegador. Las
-- escrituras las hace la API con service_role tras verificar el rol.
create policy "api_keys_select_admins" on public.api_keys
  for select to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

revoke select on public.api_keys from anon, authenticated;
grant select (id, company_id, project_id, name, prefix, last4, created_by, created_at, last_used_at, revoked_at)
  on public.api_keys to authenticated;

-- Uso por la API de servidor (canal "api").
alter table public.usage_events drop constraint usage_events_channel_check;
alter table public.usage_events
  add constraint usage_events_channel_check
  check (channel in ('app', 'widget', 'api', 'eval', 'warm', 'ocr', 'enrich'));
