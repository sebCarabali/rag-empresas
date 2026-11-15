-- =====================================================================
-- Las claves ya no son de la empresa: se borran las claves de empresa del
-- Vault (se copiaron a cada asistente en la migración anterior) y las
-- funciones que las manejaban.
-- =====================================================================

delete from vault.secrets
where id in (
  select unnest(array[gemini_secret_id, openai_secret_id, groq_secret_id])
  from public.company_secrets
);

drop function if exists public.set_company_provider_key(uuid, text, text);
drop function if exists public.delete_company_provider_key(uuid, text);
drop function if exists public.get_company_provider_key(uuid, text);
drop function if exists public.set_company_gemini_key(uuid, text);
drop function if exists public.delete_company_gemini_key(uuid);
drop function if exists public.get_company_gemini_key(uuid);
drop table if exists public.company_secrets;
