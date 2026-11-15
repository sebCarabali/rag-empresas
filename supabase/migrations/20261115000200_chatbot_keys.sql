-- =====================================================================
-- Claves de API por asistente (proyecto), no por empresa ni de la plataforma.
-- - La clave en claro vive solo en vault.secrets (cifrada en reposo).
-- - chatbot_secrets guarda la referencia y los últimos 4 caracteres.
-- - Guardar/eliminar: owner o admin de la empresa del proyecto.
-- - Leer descifrada: solo service_role (la API).
-- =====================================================================

create table public.chatbot_secrets (
  project_id             uuid primary key references public.projects (id) on delete cascade,
  company_id             uuid not null references public.companies (id) on delete cascade,
  gemini_secret_id       uuid,
  gemini_key_last4       text,
  gemini_key_updated_at  timestamptz,
  openai_secret_id       uuid,
  openai_key_last4       text,
  openai_key_updated_at  timestamptz,
  groq_secret_id         uuid,
  groq_key_last4         text,
  groq_key_updated_at    timestamptz,
  updated_by             uuid references auth.users (id) on delete set null
);

alter table public.chatbot_secrets enable row level security;

-- Los miembros ven qué claves hay y sus últimos 4 caracteres; nadie escribe directo.
create policy "chatbot_secrets_select_members" on public.chatbot_secrets
  for select to authenticated
  using (public.is_company_member(company_id));

-- Al borrar el proyecto se borran también sus secretos del Vault.
create or replace function public.chatbot_secrets_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets
  where id in (old.gemini_secret_id, old.openai_secret_id, old.groq_secret_id);
  return old;
end;
$$;

create trigger chatbot_secrets_cleanup
  after delete on public.chatbot_secrets
  for each row execute function public.chatbot_secrets_cleanup();

revoke execute on function public.chatbot_secrets_cleanup() from public, anon, authenticated;

create or replace function public.set_project_provider_key(p_project_id uuid, p_provider text, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key     text := trim(coalesce(p_key, ''));
  v_company uuid;
  v_id      uuid;
begin
  if p_provider not in ('gemini', 'openai', 'groq') then
    raise exception 'Proveedor no válido' using errcode = '22023';
  end if;
  select company_id into v_company from public.projects where id = p_project_id;
  if v_company is null or not public.has_company_role(v_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permiso para cambiar las claves de este asistente' using errcode = '42501';
  end if;
  if char_length(v_key) < 20 or char_length(v_key) > 300 or v_key ~ '\s' then
    raise exception 'La clave no tiene un formato válido' using errcode = '22023';
  end if;

  insert into public.chatbot_secrets (project_id, company_id) values (p_project_id, v_company)
  on conflict (project_id) do nothing;
  execute format('select %I from public.chatbot_secrets where project_id = $1', p_provider || '_secret_id')
    into v_id using p_project_id;

  if v_id is null then
    v_id := vault.create_secret(v_key, p_provider || '_key_' || p_project_id::text, 'Clave de ' || p_provider || ' del asistente');
  else
    perform vault.update_secret(v_id, v_key);
  end if;

  execute format(
    'update public.chatbot_secrets set %I = $1, %I = $2, %I = now(), updated_by = auth.uid() where project_id = $3',
    p_provider || '_secret_id', p_provider || '_key_last4', p_provider || '_key_updated_at'
  ) using v_id, right(v_key, 4), p_project_id;
end;
$$;

create or replace function public.delete_project_provider_key(p_project_id uuid, p_provider text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_id      uuid;
begin
  if p_provider not in ('gemini', 'openai', 'groq') then
    raise exception 'Proveedor no válido' using errcode = '22023';
  end if;
  select company_id into v_company from public.projects where id = p_project_id;
  if v_company is null or not public.has_company_role(v_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permiso para cambiar las claves de este asistente' using errcode = '42501';
  end if;

  execute format('select %I from public.chatbot_secrets where project_id = $1', p_provider || '_secret_id')
    into v_id using p_project_id;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
  execute format(
    'update public.chatbot_secrets set %I = null, %I = null, %I = now(), updated_by = auth.uid() where project_id = $1',
    p_provider || '_secret_id', p_provider || '_key_last4', p_provider || '_key_updated_at'
  ) using p_project_id;
end;
$$;

create or replace function public.get_project_provider_key(p_project_id uuid, p_provider text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id  uuid;
  v_key text;
begin
  if p_provider not in ('gemini', 'openai', 'groq') then
    return null;
  end if;
  execute format('select %I from public.chatbot_secrets where project_id = $1', p_provider || '_secret_id')
    into v_id using p_project_id;
  if v_id is null then
    return null;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where id = v_id;
  return v_key;
end;
$$;

revoke execute on function public.set_project_provider_key(uuid, text, text) from public, anon;
revoke execute on function public.delete_project_provider_key(uuid, text) from public, anon;
revoke execute on function public.get_project_provider_key(uuid, text) from public, anon, authenticated;
grant execute on function public.set_project_provider_key(uuid, text, text) to authenticated;
grant execute on function public.delete_project_provider_key(uuid, text) to authenticated;
grant execute on function public.get_project_provider_key(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- Las claves que las empresas ya habían guardado pasan a cada uno de sus
-- asistentes (un secreto propio por proyecto), para no dejar de responder.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_provider text;
  v_key text;
  v_id uuid;
begin
  for r in select p.id as project_id, p.company_id from public.projects p loop
    foreach v_provider in array array['gemini', 'openai', 'groq'] loop
      v_key := public.get_company_provider_key(r.company_id, v_provider);
      if v_key is null then
        continue;
      end if;
      insert into public.chatbot_secrets (project_id, company_id) values (r.project_id, r.company_id)
      on conflict (project_id) do nothing;
      v_id := vault.create_secret(v_key, v_provider || '_key_' || r.project_id::text, 'Clave de ' || v_provider || ' del asistente');
      execute format(
        'update public.chatbot_secrets set %I = $1, %I = $2, %I = now() where project_id = $3',
        v_provider || '_secret_id', v_provider || '_key_last4', v_provider || '_key_updated_at'
      ) using v_id, right(v_key, 4), r.project_id;
    end loop;
  end loop;
end;
$$;

-- Sin clave de la plataforma, el respaldo solo existe si el asistente guarda la clave de ese proveedor.
alter table public.chatbots alter column llm_fallback set default 'none';
update public.chatbots b
set llm_fallback = 'none', llm_fallback_model = null
where llm_fallback <> 'none'
  and not exists (
    select 1 from public.chatbot_secrets s
    where s.project_id = b.project_id
      and case b.llm_fallback
            when 'gemini' then s.gemini_secret_id is not null
            when 'openai' then s.openai_secret_id is not null
            when 'groq' then s.groq_secret_id is not null
          end
  );
