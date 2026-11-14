-- =====================================================================
-- Búsqueda híbrida (vectorial + texto completo en español)
-- combinada con Reciprocal Rank Fusion (RRF).
-- security invoker => se aplican las políticas RLS del usuario que llama.
-- =====================================================================

create or replace function public.match_document_chunks(
  p_project_id      uuid,
  query_embedding   extensions.vector(384),
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
  -- Las preguntas en lenguaje natural casi nunca contienen TODAS las palabras
  -- de un fragmento, así que se usa OR entre términos en lugar de AND.
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

grant execute on function public.match_document_chunks(uuid, extensions.vector, text, int, float, float, int)
  to authenticated;
