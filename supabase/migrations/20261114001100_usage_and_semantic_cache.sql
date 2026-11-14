-- =====================================================================
-- Menos costo y más rapidez:
--   * caché por significado (embedding de la pregunta en answer_cache)
--   * precalentamiento de la caché (cache_warm_runs)
--   * registro de uso para el panel (usage_events + usage_daily)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Caché por significado
-- ---------------------------------------------------------------------
alter table public.answer_cache
  add column question_embedding extensions.vector(384),
  add column content_version    text,
  add column variant            text,
  add column model              text;

create index answer_cache_semantic_idx on public.answer_cache (project_id, content_version, variant, model);

/** Preguntas en caché más parecidas (coseno) para la misma versión del contenido. */
create or replace function public.match_answer_cache(
  p_project_id uuid,
  p_version text,
  p_variant text,
  p_model text,
  p_embedding extensions.vector(384),
  p_min_similarity float,
  p_limit int default 5
)
returns table (cache_key text, question text, similarity float)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select c.cache_key, c.question, 1 - (c.question_embedding <=> p_embedding) as similarity
  from public.answer_cache c
  where c.project_id = p_project_id
    and c.content_version = p_version
    and c.variant = p_variant
    and c.model = p_model
    and c.question_embedding is not null
    and c.expires_at > now()
    and 1 - (c.question_embedding <=> p_embedding) >= p_min_similarity
  order by c.question_embedding <=> p_embedding
  limit least(greatest(p_limit, 1), 10);
$$;

/**
 * Vocabulario distintivo del catálogo: palabras de los valores de campos
 * categóricos (composición, submarca, familia…). Dos preguntas que difieren
 * en una de estas palabras no comparten respuesta aunque se parezcan.
 */
create or replace function public.catalog_vocabulary(p_project_id uuid)
returns setof text
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with kv as (
    select e.key, e.value
    from public.catalog_items c, jsonb_each_text(c.attributes) e
    where c.project_id = p_project_id and e.value <> ''
  ),
  categorical as (
    select key from kv group by key having count(distinct value) <= 300
  ),
  vals as (
    select distinct value from kv where key in (select key from categorical)
  )
  select distinct w
  from vals, regexp_split_to_table(extensions.unaccent(lower(vals.value)), '[^a-z0-9]+') w
  where length(w) >= 3;
$$;

revoke execute on function public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int) from public, anon, authenticated;
grant execute on function public.match_answer_cache(uuid, text, text, text, extensions.vector, float, int) to service_role;
revoke execute on function public.catalog_vocabulary(uuid) from public, anon;
grant execute on function public.catalog_vocabulary(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Registro de uso (lo escribe la API con service_role)
-- ---------------------------------------------------------------------
create table public.usage_events (
  id             bigint generated always as identity primary key,
  company_id     uuid not null references public.companies (id) on delete cascade,
  project_id     uuid references public.projects (id) on delete cascade,
  -- app: chat interno · widget: sitio web · eval: pruebas · warm: precalentamiento
  -- ocr: lectura de escaneos · enrich: descripciones web
  channel        text not null check (channel in ('app', 'widget', 'eval', 'warm', 'ocr', 'enrich')),
  -- null: generada por el modelo · exact / semantic: servida desde la caché
  cache_match    text check (cache_match in ('exact', 'semantic')),
  provider       text check (provider in ('gemini', 'groq')),
  model          text,
  fallback       boolean not null default false,
  key_owner      text check (key_owner in ('company', 'platform')),
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_usd       numeric(12, 6) not null default 0,
  duration_ms    integer,
  created_at     timestamptz not null default now()
);

create index usage_events_project_idx on public.usage_events (project_id, created_at desc);
create index usage_events_company_idx on public.usage_events (company_id, created_at desc);

alter table public.usage_events enable row level security;

create policy "usage_events_select_admins" on public.usage_events
  for select to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

/** Resumen diario del uso de un proyecto (respeta RLS: solo owner/admin). */
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
    count(*) filter (where u.provider = 'groq' and u.cache_match is null)::int,
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

revoke execute on function public.usage_daily(uuid, int, text) from public, anon;
grant execute on function public.usage_daily(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------
-- Precalentamiento de la caché
-- ---------------------------------------------------------------------
create table public.cache_warm_runs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'skipped')),
  -- manual: botón · auto: después de cambiar los documentos
  trigger      text not null default 'manual' check (trigger in ('manual', 'auto')),
  questions    jsonb not null default '[]'::jsonb,
  total        integer not null default 0,
  done         integer not null default 0,
  generated    integer not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index cache_warm_runs_project_idx on public.cache_warm_runs (project_id, created_at desc);

alter table public.cache_warm_runs enable row level security;

create policy "cache_warm_runs_select_members" on public.cache_warm_runs
  for select to authenticated using (public.is_company_member(company_id));
