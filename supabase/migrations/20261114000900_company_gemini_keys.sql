-- =====================================================================
-- Clave de Gemini propia de cada empresa, cifrada con Supabase Vault.
-- - La clave en claro vive solo en vault.secrets (cifrada en reposo).
-- - company_secrets guarda la referencia y los últimos 4 caracteres para
--   mostrar en la interfaz; nunca la clave.
-- - Solo service_role (la API) puede leerla descifrada.
-- =====================================================================

create table public.company_secrets (
  company_id             uuid primary key references public.companies (id) on delete cascade,
  gemini_secret_id       uuid,
  gemini_key_last4       text,
  gemini_key_updated_at  timestamptz,
  gemini_key_updated_by  uuid references auth.users (id) on delete set null
);

alter table public.company_secrets enable row level security;

-- Los miembros ven si hay clave y sus últimos 4 caracteres. Nadie escribe directo:
-- solo a través de las funciones de abajo.
create policy "company_secrets_select_members" on public.company_secrets
  for select to authenticated
  using (public.is_company_member(company_id));

-- ---------------------------------------------------------------------
-- Guardar o reemplazar la clave (owner/admin).
-- ---------------------------------------------------------------------
create or replace function public.set_company_gemini_key(p_company_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := trim(coalesce(p_key, ''));
  v_id  uuid;
begin
  if not public.has_company_role(p_company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permiso para cambiar la clave de la empresa' using errcode = '42501';
  end if;
  if char_length(v_key) < 20 or char_length(v_key) > 200 or v_key ~ '\s' then
    raise exception 'La clave no tiene un formato válido' using errcode = '22023';
  end if;

  select gemini_secret_id into v_id from public.company_secrets where company_id = p_company_id;

  if v_id is null then
    v_id := vault.create_secret(v_key, 'gemini_key_' || p_company_id::text, 'Clave de Gemini de la empresa');
  else
    perform vault.update_secret(v_id, v_key);
  end if;

  insert into public.company_secrets (company_id, gemini_secret_id, gemini_key_last4, gemini_key_updated_at, gemini_key_updated_by)
  values (p_company_id, v_id, right(v_key, 4), now(), auth.uid())
  on conflict (company_id) do update set
    gemini_secret_id      = excluded.gemini_secret_id,
    gemini_key_last4      = excluded.gemini_key_last4,
    gemini_key_updated_at = excluded.gemini_key_updated_at,
    gemini_key_updated_by = excluded.gemini_key_updated_by;
end;
$$;

-- ---------------------------------------------------------------------
-- Eliminar la clave (vuelve a usarse la de la plataforma).
-- ---------------------------------------------------------------------
create or replace function public.delete_company_gemini_key(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.has_company_role(p_company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permiso para cambiar la clave de la empresa' using errcode = '42501';
  end if;

  select gemini_secret_id into v_id from public.company_secrets where company_id = p_company_id;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
  update public.company_secrets
     set gemini_secret_id = null, gemini_key_last4 = null, gemini_key_updated_at = now(), gemini_key_updated_by = auth.uid()
   where company_id = p_company_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Leer la clave descifrada: SOLO la API (service_role).
-- ---------------------------------------------------------------------
create or replace function public.get_company_gemini_key(p_company_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
  from public.company_secrets s
  join vault.decrypted_secrets d on d.id = s.gemini_secret_id
  where s.company_id = p_company_id;
$$;

revoke execute on function public.set_company_gemini_key(uuid, text) from public, anon;
revoke execute on function public.delete_company_gemini_key(uuid) from public, anon;
revoke execute on function public.get_company_gemini_key(uuid) from public, anon, authenticated;
grant execute on function public.set_company_gemini_key(uuid, text) to authenticated;
grant execute on function public.delete_company_gemini_key(uuid) to authenticated;
grant execute on function public.get_company_gemini_key(uuid) to service_role;
