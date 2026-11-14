-- =====================================================================
-- Restringe quién puede ejecutar las funciones SECURITY DEFINER.
-- Postgres concede EXECUTE a PUBLIC por defecto; aquí se retira.
-- =====================================================================

-- Función de trigger: nadie debe llamarla por RPC.
revoke execute on function public.add_company_owner() from public, anon, authenticated;

-- Helpers de autorización: los necesitan las políticas RLS (que se evalúan
-- como el usuario autenticado) y la API. Solo revelan la membresía propia.
revoke execute on function public.is_company_member(uuid) from public, anon;
revoke execute on function public.has_company_role(uuid, public.member_role[]) from public, anon;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.has_company_role(uuid, public.member_role[]) to authenticated;

-- La búsqueda es security invoker (aplica RLS), pero tampoco tiene sentido para anon.
revoke execute on function public.match_document_chunks(uuid, extensions.vector, text, int, float, float, int)
  from public, anon;
