-- Caché de respuestas: búsqueda de la misma pregunta en otra variante (chat
-- interno / widget) y limpieza de entradas que ya no se pueden usar.

-- p_variant null = cualquier variante. Devuelve también la variante.
drop function if exists public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int);

create function public.match_answer_cache(
  p_project_id uuid,
  p_version text,
  p_variant text,
  p_model text,
  p_embedding extensions.vector(384),
  p_min_similarity float,
  p_limit int default 5
)
returns table (cache_key text, question text, similarity float, variant text)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select c.cache_key, c.question, 1 - (c.question_embedding <=> p_embedding) as similarity, c.variant
  from public.answer_cache c
  where c.project_id = p_project_id
    and c.content_version = p_version
    and (p_variant is null or c.variant = p_variant)
    and c.model = p_model
    and c.question_embedding is not null
    and c.expires_at > now()
    and 1 - (c.question_embedding <=> p_embedding) >= p_min_similarity
  order by c.question_embedding <=> p_embedding
  limit least(greatest(p_limit, 1), 10);
$$;

revoke execute on function public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int) from public, anon, authenticated;
grant execute on function public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int) to service_role;

-- Entradas creadas antes de la clave actual (sin versión de contenido): ya no
-- coinciden con ninguna pregunta y solo confunden al revisar la tabla.
delete from public.answer_cache where content_version is null;

-- Entradas de versiones del contenido anteriores a la vigente de cada proyecto.
delete from public.answer_cache c
where exists (
  select 1 from public.answer_cache n
  where n.project_id = c.project_id
    and n.content_version is not null
    and n.created_at > c.created_at
    and n.content_version <> c.content_version
);
