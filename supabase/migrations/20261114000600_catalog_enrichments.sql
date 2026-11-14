-- =====================================================================
-- Descripciones generales de tipos de tela obtenidas con búsqueda web
-- (Gemini + Google Search), una por valor de campo y proyecto.
-- Ej.: field = 'Familia', value = 'Popelina Rigida'.
-- Se generan una sola vez al procesar un CSV y se reutilizan.
-- =====================================================================

create table public.catalog_enrichments (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references public.companies (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  field           text not null,
  value           text not null,
  description     text,
  sources         jsonb not null default '[]'::jsonb,   -- [{ "title": "...", "url": "..." }]
  search_queries  jsonb not null default '[]'::jsonb,
  status          text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error           text,
  model           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, field, value)
);

create index catalog_enrichments_project_idx on public.catalog_enrichments (project_id, status);

create trigger catalog_enrichments_updated_at
  before update on public.catalog_enrichments
  for each row execute function public.set_updated_at();

alter table public.catalog_enrichments enable row level security;

-- Lectura para miembros; la escritura la hace solo el worker (service_role).
create policy "enrichments_select_members" on public.catalog_enrichments
  for select to authenticated
  using (public.is_company_member(company_id));

-- ---------------------------------------------------------------------
-- Valores distintos de ciertos campos del catálogo, con contexto para
-- describirlos mejor (composiciones y tipos de tejido más frecuentes).
-- Los nombres de campo se comparan sin tildes ni mayúsculas.
-- ---------------------------------------------------------------------
create or replace function public.catalog_distinct_values(p_project_id uuid, p_fields text[])
returns table (campo text, valor text, productos integer, contexto jsonb)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with wanted as (
    select extensions.unaccent(lower(f)) as f from unnest(p_fields) f
  ),
  kv as (
    select c.id, e.key, e.value, c.attributes
    from public.catalog_items c, jsonb_each_text(c.attributes) e
    where c.project_id = p_project_id
      and e.value <> ''
      and extensions.unaccent(lower(e.key)) in (select f from wanted)
  )
  select
    kv.key,
    kv.value,
    count(*)::int,
    jsonb_build_object(
      'composiciones', (
        select coalesce(jsonb_agg(x.v), '[]'::jsonb) from (
          select k2.attributes->>'Composición' as v from kv k2
          where k2.key = kv.key and k2.value = kv.value and k2.attributes ? 'Composición'
          group by 1 order by count(*) desc limit 3) x),
      'tipos_de_tejido', (
        select coalesce(jsonb_agg(x.v), '[]'::jsonb) from (
          select k2.attributes->>'Tipo de tejido' as v from kv k2
          where k2.key = kv.key and k2.value = kv.value and k2.attributes ? 'Tipo de tejido'
          group by 1 order by count(*) desc limit 2) x)
    )
  from kv
  group by kv.key, kv.value
  order by kv.key, count(*) desc;
$$;

revoke execute on function public.catalog_distinct_values(uuid, text[]) from public, anon;
grant execute on function public.catalog_distinct_values(uuid, text[]) to authenticated;
