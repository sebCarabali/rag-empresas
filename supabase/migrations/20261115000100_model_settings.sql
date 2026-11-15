-- =====================================================================
-- Modelos por proyecto (en la configuración del asistente):
--   * proveedor y modelo de lenguaje principal y de respaldo
--   * modelo de embeddings (local o por API)
--   * claves de OpenAI y Groq de la empresa (Supabase Vault), como la de Gemini
-- Los embeddings pasan a guardar con qué modelo se calcularon: un proyecto
-- puede usar 768 dimensiones y otro 1536 en la misma tabla.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuración de modelos del asistente (null = valor por defecto de la plataforma)
-- ---------------------------------------------------------------------
alter table public.chatbots
  add column llm_provider        text not null default 'gemini' check (llm_provider in ('gemini', 'groq', 'openai')),
  add column llm_model           text check (llm_model is null or char_length(llm_model) between 2 and 100),
  add column llm_fallback        text not null default 'groq' check (llm_fallback in ('none', 'gemini', 'groq', 'openai')),
  add column llm_fallback_model  text check (llm_fallback_model is null or char_length(llm_fallback_model) between 2 and 100),
  add column embedding_model     text check (embedding_model is null or char_length(embedding_model) between 2 and 100);

-- ---------------------------------------------------------------------
-- Embeddings de cualquier dimensión, marcados con su modelo
-- ---------------------------------------------------------------------
drop function if exists public.set_embedding_dimensions(int);
drop index if exists public.document_chunks_embedding_idx;

alter table public.document_chunks alter column embedding type extensions.vector;
alter table public.document_chunks add column embedding_model text;
update public.document_chunks c
set embedding_model = p.embedding_model
from public.projects p
where p.id = c.project_id and c.embedding is not null;
-- Los que se estén reindexando quedan con el modelo vigente de la plataforma.
update public.document_chunks set embedding_model = 'Xenova/multilingual-e5-base'
where embedding is not null and embedding_model is null;

create index document_chunks_project_model_idx on public.document_chunks (project_id, embedding_model);

alter table public.answer_cache alter column question_embedding type extensions.vector;
alter table public.answer_cache add column question_embedding_model text;
update public.answer_cache set question_embedding_model = 'Xenova/multilingual-e5-base' where question_embedding is not null;

-- Búsqueda híbrida: la parte vectorial solo compara con fragmentos del mismo modelo.
-- Es una búsqueda exacta (sin índice ANN, que exige una dimensión fija): con el
-- filtro por proyecto es rápida hasta decenas de miles de fragmentos por proyecto.
drop function if exists public.match_document_chunks(uuid, extensions.vector, text, int, float, float, int);

create function public.match_document_chunks(
  p_project_id       uuid,
  query_embedding    extensions.vector,
  query_text         text,
  match_count        int   default 8,
  full_text_weight   float default 1.0,
  semantic_weight    float default 1.0,
  rrf_k              int   default 50,
  p_embedding_model  text  default null
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
      and (p_embedding_model is null or c.embedding_model = p_embedding_model)
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

revoke execute on function public.match_document_chunks(uuid, extensions.vector, text, int, float, float, int, text) from public, anon;
grant execute on function public.match_document_chunks(uuid, extensions.vector, text, int, float, float, int, text) to authenticated, service_role;

drop function if exists public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int);

create function public.match_answer_cache(
  p_project_id uuid,
  p_version text,
  p_variant text,
  p_model text,
  p_embedding extensions.vector,
  p_min_similarity float,
  p_limit int default 5,
  p_embedding_model text default null
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
    and (p_embedding_model is null or c.question_embedding_model = p_embedding_model)
    and extensions.vector_dims(c.question_embedding) = extensions.vector_dims(p_embedding)
    and c.expires_at > now()
    and 1 - (c.question_embedding <=> p_embedding) >= p_min_similarity
  order by c.question_embedding <=> p_embedding
  limit least(greatest(p_limit, 1), 10);
$$;

revoke execute on function public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int, text) from public, anon, authenticated;
grant execute on function public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int, text) to service_role;

-- ---------------------------------------------------------------------
-- Uso: nuevo proveedor y respaldo genérico
-- ---------------------------------------------------------------------
alter table public.usage_events drop constraint usage_events_provider_check;
alter table public.usage_events
  add constraint usage_events_provider_check check (provider in ('gemini', 'groq', 'openai'));

-- La columna "groq" ahora cuenta las respuestas del modelo de respaldo, sea cual sea.
create or replace function public.usage_daily(p_project_id uuid, p_days int default 30, p_tz text default 'UTC')
returns table (
  day             date,
  channel         text,
  total           integer,
  cache_exact     integer,
  cache_semantic  integer,
  groq            integer,
  input_tokens    bigint,
  output_tokens   bigint,
  cost_usd        numeric,
  company_cost    numeric,
  avg_ms          integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (u.created_at at time zone p_tz)::date,
    u.channel,
    count(*)::int,
    count(*) filter (where u.cache_match = 'exact')::int,
    count(*) filter (where u.cache_match = 'semantic')::int,
    count(*) filter (where u.fallback and u.cache_match is null)::int,
    sum(u.input_tokens)::bigint,
    sum(u.output_tokens)::bigint,
    sum(u.cost_usd),
    sum(u.cost_usd) filter (where u.key_owner = 'company'),
    avg(u.duration_ms)::int
  from public.usage_events u
  where u.project_id = p_project_id
    and u.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 365))
  group by 1, 2
  order by 1, 2;
$$;

-- ---------------------------------------------------------------------
-- Claves de OpenAI y Groq de la empresa (igual que la de Gemini)
-- ---------------------------------------------------------------------
alter table public.company_secrets
  add column openai_secret_id       uuid,
  add column openai_key_last4       text,
  add column openai_key_updated_at  timestamptz,
  add column groq_secret_id         uuid,
  add column groq_key_last4         text,
  add column groq_key_updated_at    timestamptz;

create or replace function public.set_company_provider_key(p_company_id uuid, p_provider text, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := trim(coalesce(p_key, ''));
  v_id  uuid;
begin
  if p_provider = 'gemini' then
    perform public.set_company_gemini_key(p_company_id, p_key);
    return;
  end if;
  if p_provider not in ('openai', 'groq') then
    raise exception 'Proveedor no válido' using errcode = '22023';
  end if;
  if not public.has_company_role(p_company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permiso para cambiar las claves de la empresa' using errcode = '42501';
  end if;
  if char_length(v_key) < 20 or char_length(v_key) > 300 or v_key ~ '\s' then
    raise exception 'La clave no tiene un formato válido' using errcode = '22023';
  end if;

  insert into public.company_secrets (company_id) values (p_company_id) on conflict (company_id) do nothing;
  execute format('select %I from public.company_secrets where company_id = $1', p_provider || '_secret_id')
    into v_id using p_company_id;

  if v_id is null then
    v_id := vault.create_secret(v_key, p_provider || '_key_' || p_company_id::text, 'Clave de ' || p_provider || ' de la empresa');
  else
    perform vault.update_secret(v_id, v_key);
  end if;

  execute format(
    'update public.company_secrets set %I = $1, %I = $2, %I = now() where company_id = $3',
    p_provider || '_secret_id', p_provider || '_key_last4', p_provider || '_key_updated_at'
  ) using v_id, right(v_key, 4), p_company_id;
end;
$$;

create or replace function public.delete_company_provider_key(p_company_id uuid, p_provider text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_provider = 'gemini' then
    perform public.delete_company_gemini_key(p_company_id);
    return;
  end if;
  if p_provider not in ('openai', 'groq') then
    raise exception 'Proveedor no válido' using errcode = '22023';
  end if;
  if not public.has_company_role(p_company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permiso para cambiar las claves de la empresa' using errcode = '42501';
  end if;

  execute format('select %I from public.company_secrets where company_id = $1', p_provider || '_secret_id')
    into v_id using p_company_id;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
  execute format(
    'update public.company_secrets set %I = null, %I = null, %I = now() where company_id = $1',
    p_provider || '_secret_id', p_provider || '_key_last4', p_provider || '_key_updated_at'
  ) using p_company_id;
end;
$$;

create or replace function public.get_company_provider_key(p_company_id uuid, p_provider text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_key text;
begin
  if p_provider not in ('gemini', 'openai', 'groq') then
    return null;
  end if;
  execute format('select %I from public.company_secrets where company_id = $1', p_provider || '_secret_id')
    into v_id using p_company_id;
  if v_id is null then
    return null;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where id = v_id;
  return v_key;
end;
$$;

revoke execute on function public.set_company_provider_key(uuid, text, text) from public, anon;
revoke execute on function public.delete_company_provider_key(uuid, text) from public, anon;
revoke execute on function public.get_company_provider_key(uuid, text) from public, anon, authenticated;
grant execute on function public.set_company_provider_key(uuid, text, text) to authenticated;
grant execute on function public.delete_company_provider_key(uuid, text) to authenticated;
grant execute on function public.get_company_provider_key(uuid, text) to service_role;
