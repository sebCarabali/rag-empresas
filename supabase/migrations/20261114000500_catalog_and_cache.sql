-- =====================================================================
-- Catálogo estructurado (filtros exactos, conteos, rankings) y caché de
-- respuestas del chat.
-- =====================================================================

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- Productos del catálogo: una fila por producto de cada CSV procesado.
-- attributes: { "Peso": "145 g/m² (±7%)", "Composición": "Algodón 100%", ... }
-- numbers:    { "Peso": 145, "Ancho": 150, ... } (número inicial de cada valor)
-- ---------------------------------------------------------------------
create table public.catalog_items (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  document_id  uuid not null references public.documents (id) on delete cascade,
  row_number   integer not null,
  name         text not null,
  code         text,
  attributes   jsonb not null default '{}'::jsonb,
  numbers      jsonb not null default '{}'::jsonb,
  image_url    text,
  created_at   timestamptz not null default now()
);

create index catalog_items_project_idx on public.catalog_items (project_id);
create index catalog_items_document_idx on public.catalog_items (document_id);
create index catalog_items_attributes_idx on public.catalog_items using gin (attributes jsonb_path_ops);

alter table public.catalog_items enable row level security;

-- Lectura para miembros; la escritura la hace solo el worker (service_role).
create policy "catalog_select_members" on public.catalog_items
  for select to authenticated
  using (public.is_company_member(company_id));

-- ---------------------------------------------------------------------
-- Campos disponibles en el catálogo de un proyecto (para describir las
-- herramientas al modelo): tipo, rango numérico y valores frecuentes.
-- ---------------------------------------------------------------------
create or replace function public.catalog_fields(p_project_id uuid)
returns table (
  campo              text,
  numerico           boolean,
  valores_distintos  integer,
  minimo             numeric,
  maximo             numeric,
  ejemplos           text[]
)
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
  nums as (
    select e.key, (e.value)::numeric as n
    from public.catalog_items c, jsonb_each_text(c.numbers) e
    where c.project_id = p_project_id
  ),
  freq as (
    select key, value, count(*) as n,
           row_number() over (partition by key order by count(*) desc, value) as rk
    from kv
    group by key, value
  )
  select
    k.key,
    coalesce(nm.cnt, 0) > 0.5 * k.cnt,
    k.distinct_cnt,
    nm.min_n,
    nm.max_n,
    (select array_agg(f.value order by f.n desc, f.value) from freq f where f.key = k.key and f.rk <= 12)
  from (
    select key, count(*) as cnt, count(distinct value)::int as distinct_cnt from kv group by key
  ) k
  left join (
    select key, count(*) as cnt, min(n) as min_n, max(n) as max_n from nums group by key
  ) nm on nm.key = k.key
  order by k.key;
$$;

-- ---------------------------------------------------------------------
-- Búsqueda con filtros exactos sobre el catálogo.
-- p_filters: [{"campo":"Peso","operador":"menor","valor":"120"}, ...]
-- Operadores: igual, contiene, no_contiene, menor, menor_o_igual, mayor, mayor_o_igual.
-- Campo especial "cualquiera": busca el texto en todos los atributos.
-- Todo valor del usuario entra con format(%L): sin riesgo de inyección SQL.
-- Con p_group_by devuelve conteos por valor en vez de productos.
-- ---------------------------------------------------------------------
create or replace function public.search_catalog(
  p_project_id  uuid,
  p_filters     jsonb default '[]'::jsonb,
  p_order_by    text  default null,
  p_order_dir   text  default 'asc',
  p_limit       int   default 20,
  p_group_by    text  default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_where   text := format('c.project_id = %L', p_project_id);
  v_filter  jsonb;
  v_field   text;
  v_op      text;
  v_value   text;
  v_num     numeric;
  v_text    text;
  v_cond    text;
  v_order   text := 'c.name, c.code';
  v_limit   int := greatest(1, least(coalesce(p_limit, 20), 50));
  v_total   int;
  v_groups  int;
  v_result  jsonb;
begin
  if jsonb_typeof(coalesce(p_filters, '[]'::jsonb)) <> 'array' then
    raise exception 'p_filters debe ser un arreglo JSON';
  end if;

  for v_filter in select value from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) loop
    v_field := nullif(trim(v_filter->>'campo'), '');
    v_op    := lower(coalesce(nullif(trim(v_filter->>'operador'), ''), 'contiene'));
    v_value := trim(v_filter->>'valor');
    if v_field is null or v_value is null then
      raise exception 'Cada filtro necesita "campo" y "valor"';
    end if;

    v_num := case when replace(v_value, ',', '.') ~ '^-?\d+(\.\d+)?$'
                  then replace(v_value, ',', '.')::numeric end;
    v_text := case when lower(v_field) = 'cualquiera'
                   then 'extensions.unaccent(lower(c.attributes::text))'
                   else format('extensions.unaccent(lower(c.attributes->>%L))', v_field) end;

    v_cond := case v_op
      when 'contiene' then
        format('strpos(%s, extensions.unaccent(lower(%L))) > 0', v_text, v_value)
      when 'no_contiene' then
        format('coalesce(strpos(%s, extensions.unaccent(lower(%L))), 0) = 0', v_text, v_value)
      when 'igual' then
        case when v_num is not null
          then format('(c.numbers->>%L)::numeric = %L::numeric', v_field, v_num)
          else format('%s = extensions.unaccent(lower(%L))', v_text, v_value) end
      when 'menor' then format('(c.numbers->>%L)::numeric < %L::numeric', v_field, v_num)
      when 'menor_o_igual' then format('(c.numbers->>%L)::numeric <= %L::numeric', v_field, v_num)
      when 'mayor' then format('(c.numbers->>%L)::numeric > %L::numeric', v_field, v_num)
      when 'mayor_o_igual' then format('(c.numbers->>%L)::numeric >= %L::numeric', v_field, v_num)
      else null
    end;

    if v_cond is null then
      raise exception 'Operador no soportado: %', v_op;
    end if;
    if v_op in ('menor', 'menor_o_igual', 'mayor', 'mayor_o_igual') and v_num is null then
      raise exception 'El operador % necesita un valor numérico (recibido: %)', v_op, v_value;
    end if;

    v_where := v_where || ' and ' || v_cond;
  end loop;

  execute format('select count(*) from public.catalog_items c where %s', v_where) into v_total;

  if nullif(trim(p_group_by), '') is not null then
    execute format(
      'select count(distinct coalesce(nullif(c.attributes->>%L, ''''), ''(sin valor)'')) from public.catalog_items c where %s',
      p_group_by, v_where) into v_groups;
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''valor'', g.v, ''cantidad'', g.n) order by g.n desc, g.v), ''[]''::jsonb)
         from (select coalesce(nullif(c.attributes->>%L, ''''), ''(sin valor)'') as v, count(*) as n
                 from public.catalog_items c where %s group by 1 order by 2 desc, 1 limit 50) g',
      p_group_by, v_where) into v_result;
    return jsonb_build_object('total', v_total, 'total_grupos', v_groups, 'agrupado_por', p_group_by, 'grupos', v_result);
  end if;

  if nullif(trim(p_order_by), '') is not null then
    v_order := format(
      '(c.numbers->>%1$L)::numeric %2$s nulls last, c.attributes->>%1$L %2$s nulls last, c.name',
      p_order_by,
      case when lower(p_order_dir) = 'desc' then 'desc' else 'asc' end);
  end if;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''nombre'', c.name, ''codigo'', c.code, ''atributos'', c.attributes) order by %1$s), ''[]''::jsonb)
       from (select * from public.catalog_items c where %2$s order by %1$s limit %3$s) c',
    v_order, v_where, v_limit) into v_result;

  return jsonb_build_object('total', v_total, 'mostrados', jsonb_array_length(v_result), 'productos', v_result);
end;
$$;

revoke execute on function public.catalog_fields(uuid) from public, anon;
revoke execute on function public.search_catalog(uuid, jsonb, text, text, int, text) from public, anon;
grant execute on function public.catalog_fields(uuid) to authenticated;
grant execute on function public.search_catalog(uuid, jsonb, text, text, int, text) to authenticated;

-- ---------------------------------------------------------------------
-- Mensajes: registrar las consultas al catálogo que hizo el asistente.
-- ---------------------------------------------------------------------
alter table public.messages add column tool_calls jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------
-- Caché de respuestas. La clave incluye la "versión" del contenido del
-- proyecto, así que cualquier cambio en sus documentos la invalida.
-- Sin políticas: solo la API (service_role) la lee y escribe.
-- ---------------------------------------------------------------------
create table public.answer_cache (
  cache_key   text primary key,
  project_id  uuid not null references public.projects (id) on delete cascade,
  question    text not null,
  answer      text not null,
  sources     jsonb not null default '[]'::jsonb,
  tool_calls  jsonb not null default '[]'::jsonb,
  hits        integer not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index answer_cache_project_idx on public.answer_cache (project_id);
create index answer_cache_expires_idx on public.answer_cache (expires_at);

alter table public.answer_cache enable row level security;
