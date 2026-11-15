-- =====================================================================
-- Mistral como proveedor de lenguaje y de embeddings.
-- =====================================================================

alter table public.chatbots drop constraint chatbots_llm_provider_check;
alter table public.chatbots
  add constraint chatbots_llm_provider_check check (llm_provider in ('gemini', 'groq', 'openai', 'mistral'));
alter table public.chatbots drop constraint chatbots_llm_fallback_check;
alter table public.chatbots
  add constraint chatbots_llm_fallback_check check (llm_fallback in ('none', 'gemini', 'groq', 'openai', 'mistral'));

alter table public.usage_events drop constraint usage_events_provider_check;
alter table public.usage_events
  add constraint usage_events_provider_check check (provider in ('gemini', 'groq', 'openai', 'mistral'));

alter table public.chatbot_secrets
  add column mistral_secret_id       uuid,
  add column mistral_key_last4       text,
  add column mistral_key_updated_at  timestamptz;

-- Al borrar el proyecto se borran también sus secretos del Vault (incluido Mistral).
create or replace function public.chatbot_secrets_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets
  where id in (old.gemini_secret_id, old.openai_secret_id, old.groq_secret_id, old.mistral_secret_id);
  return old;
end;
$$;

-- Las funciones de claves aceptan 'mistral' (misma lógica que antes).
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
  if p_provider not in ('gemini', 'openai', 'groq', 'mistral') then
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
  if p_provider not in ('gemini', 'openai', 'groq', 'mistral') then
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
  if p_provider not in ('gemini', 'openai', 'groq', 'mistral') then
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
