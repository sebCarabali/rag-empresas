-- =====================================================================
-- Preparar el cambio de modelo de embeddings sin perder la búsqueda:
--   * las funciones de búsqueda aceptan vectores de cualquier dimensión
--   * un fragmento puede quedar sin embedding mientras se reindexa (la
--     búsqueda por texto sigue funcionando)
--   * cada proyecto guarda con qué modelo está indexado y el avance del reindexado
--   * set_embedding_dimensions(n) cambia la dimensión de las columnas (solo service_role)
-- =====================================================================

alter table public.document_chunks alter column embedding drop not null;

alter table public.projects
  add column embedding_model      text,
  add column reindex_status       text check (reindex_status in ('running', 'done', 'failed')),
  add column reindex_done         integer not null default 0,
  add column reindex_total        integer not null default 0,
  add column reindex_started_at   timestamptz,
  add column reindex_finished_at  timestamptz,
  add column reindex_error        text;

-- Todo lo indexado hasta ahora se hizo con el modelo por defecto.
update public.projects set embedding_model = 'Xenova/multilingual-e5-small' where embedding_model is null;

-- ---------------------------------------------------------------------
-- Búsqueda híbrida: mismo cuerpo, parámetro sin dimensión fija y sin
-- fragmentos pendientes de reindexar en la parte vectorial.
-- ---------------------------------------------------------------------
drop function if exists public.match_document_chunks(uuid, extensions.vector, text, int, float, float, int);

create function public.match_document_chunks(
  p_project_id      uuid,
  query_embedding   extensions.vector,
  query_text        text,
  match_count       int   default 8,
  full_text_weight  float default 1.0,
  semantic_weight   float default 1.0,
  rrf_k             int   default 50
)
returns table (
  id           uuid,
  document_id  uuid,
  chunk_index  int,
  content      text,
  metadata     jsonb,
  score        float
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with
  q as (
    select to_tsquery(
      'spanish',
      coalesce(nullif(replace(plainto_tsquery('spanish', query_text)::text, ' & ', ' | '), ''), '''''')
    ) as tsq
  ),
  full_text as (
    select
      c.id,
      row_number() over (order by ts_rank_cd(c.fts, q.tsq) desc) as rank_ix
    from public.document_chunks c, q
    where c.project_id = p_project_id
      and c.fts @@ q.tsq
    order by rank_ix
    limit least(match_count, 30) * 2
  ),
  semantic as (
    select
      c.id,
      row_number() over (order by c.embedding <=> query_embedding) as rank_ix
    from public.document_chunks c
    where c.project_id = p_project_id
      and c.embedding is not null
      and extensions.vector_dims(c.embedding) = extensions.vector_dims(query_embedding)
    order by rank_ix
    limit least(match_count, 30) * 2
  )
  select
    c.id,
    c.document_id,
    c.chunk_index,
    c.content,
    c.metadata,
    (
      coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight +
      coalesce(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight
    )::float as score
  from full_text ft
  full outer join semantic s on ft.id = s.id
  join public.document_chunks c on c.id = coalesce(ft.id, s.id)
  order by score desc
  limit least(match_count, 30);
$$;

revoke execute on function public.match_document_chunks(uuid, extensions.vector, text, int, float, float, int)
  from public, anon;
grant execute on function public.match_document_chunks(uuid, extensions.vector, text, int, float, float, int)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Caché por significado: igual, sin dimensión fija.
-- ---------------------------------------------------------------------
drop function if exists public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int);

create function public.match_answer_cache(
  p_project_id uuid,
  p_version text,
  p_variant text,
  p_model text,
  p_embedding extensions.vector,
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
    and extensions.vector_dims(c.question_embedding) = extensions.vector_dims(p_embedding)
    and c.expires_at > now()
    and 1 - (c.question_embedding <=> p_embedding) >= p_min_similarity
  order by c.question_embedding <=> p_embedding
  limit least(greatest(p_limit, 1), 10);
$$;

revoke execute on function public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int) from public, anon, authenticated;
grant execute on function public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int) to service_role;

-- ---------------------------------------------------------------------
-- Cambiar la dimensión de los vectores (p. ej. 384 -> 768 para e5-base).
-- Borra los embeddings actuales (el texto de los fragmentos se conserva):
-- la API los recalcula al reindexar cada proyecto. La búsqueda por texto
-- sigue funcionando mientras tanto. Las respuestas en caché se conservan;
-- solo se quita el embedding de la pregunta.
-- ---------------------------------------------------------------------
create or replace function public.set_embedding_dimensions(p_dims int)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_dims int;
begin
  if p_dims not between 64 and 2000 then
    raise exception 'Dimensión no válida: %', p_dims;
  end if;

  select a.atttypmod into current_dims
  from pg_attribute a
  where a.attrelid = 'public.document_chunks'::regclass and a.attname = 'embedding';
  if current_dims = p_dims then
    return;
  end if;

  drop index if exists public.document_chunks_embedding_idx;
  execute format('alter table public.document_chunks alter column embedding type extensions.vector(%s) using null', p_dims);
  execute 'create index document_chunks_embedding_idx on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops)';
  execute format('alter table public.answer_cache alter column question_embedding type extensions.vector(%s) using null', p_dims);

  -- Todos los proyectos quedan pendientes de reindexar.
  update public.projects
  set embedding_model = null, reindex_status = null, reindex_done = 0, reindex_total = 0, reindex_error = null;
end;
$$;

revoke execute on function public.set_embedding_dimensions(int) from public, anon, authenticated;
grant execute on function public.set_embedding_dimensions(int) to service_role;
