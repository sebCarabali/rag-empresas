import type { FunctionDeclaration } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Source } from './prompt';

interface CatalogField {
  campo: string;
  numerico: boolean;
  valores_distintos: number;
  minimo: number | null;
  maximo: number | null;
  ejemplos: string[] | null;
}

export interface CatalogToolCall {
  name: string;
  args: Record<string, unknown>;
  total: number | null;
  summary: string;
  error?: string;
}

const OPERATORS = ['igual', 'contiene', 'no_contiene', 'menor', 'menor_o_igual', 'mayor', 'mayor_o_igual'];
const OP_LABEL: Record<string, string> = {
  igual: '=',
  contiene: 'contiene',
  no_contiene: 'no contiene',
  menor: '<',
  menor_o_igual: '≤',
  mayor: '>',
  mayor_o_igual: '≥',
};

/** Productos de buscar_productos que se registran como fuentes citables. */
const MAX_PRODUCTS_AS_SOURCES = 10;

export interface CatalogContext {
  totalProducts: number;
  declarations: FunctionDeclaration[];
  instructions: string;
}

/** Describe el catálogo del proyecto para que el modelo sepa qué campos puede filtrar. */
export async function loadCatalogContext(db: SupabaseClient, projectId: string): Promise<CatalogContext | null> {
  const { count, error: countError } = await db
    .from('catalog_items')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  if (countError || !count) return null;

  const { data, error } = await db.rpc('catalog_fields', { p_project_id: projectId });
  if (error || !data?.length) return null;
  const fields = data as CatalogField[];

  const fieldNames = fields.map((f) => f.campo);
  const fieldDocs = fields
    .map((f) => {
      if (f.numerico) {
        return `- ${f.campo} (número, de ${f.minimo} a ${f.maximo}; ej. "${f.ejemplos?.[0] ?? ''}")`;
      }
      const samples = (f.ejemplos ?? []).slice(0, f.valores_distintos <= 15 ? 15 : 6).map((e) => `"${e}"`);
      const more = f.valores_distintos > samples.length ? `, … (${f.valores_distintos} valores distintos)` : '';
      return `- ${f.campo} (texto: ${samples.join(', ')}${more})`;
    })
    .join('\n');

  const filtros = {
    type: 'array',
    description:
      'Condiciones que deben cumplirse todas. Para números usa menor/mayor/igual con el valor numérico ' +
      '(p. ej. Peso menor 120). Para texto usa igual o contiene (no distingue tildes ni mayúsculas). ' +
      'Campo "cualquiera" busca el texto en todos los atributos.',
    items: {
      type: 'object',
      properties: {
        campo: { type: 'string', enum: [...fieldNames, 'cualquiera'] },
        operador: { type: 'string', enum: OPERATORS },
        valor: { type: 'string' },
      },
      required: ['campo', 'operador', 'valor'],
    },
  };

  const declarations: FunctionDeclaration[] = [
    {
      name: 'contar_productos',
      description:
        'Cuenta productos del catálogo que cumplen filtros exactos y, opcionalmente, los agrupa por un campo ' +
        '(p. ej. cuántos hay por Nombre, Familia o Submarca). Úsala para "cuántos", "qué opciones hay", ' +
        'listados completos resumidos y para comprobar si algo existe.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          filtros,
          agrupar_por: { type: 'string', enum: fieldNames, description: 'Campo por el que agrupar los conteos.' },
        },
      },
    },
    {
      name: 'buscar_productos',
      description:
        'Devuelve productos del catálogo (máximo 50) que cumplen filtros exactos, con todos sus atributos, ' +
        'opcionalmente ordenados. Úsala para rankings ("el más pesado", "los 5 más anchos") y para ver ejemplos concretos.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          filtros,
          ordenar_por: { type: 'string', enum: fieldNames },
          orden: { type: 'string', enum: ['asc', 'desc'] },
          limite: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
  ];

  const instructions = `
Este proyecto tiene además un CATÁLOGO ESTRUCTURADO con ${count} productos, consultable con las herramientas contar_productos y buscar_productos.
Campos disponibles:
${fieldDocs}

Cuándo usar las herramientas (en vez de solo el <contexto>):
- Filtros numéricos (peso, ancho, rendimiento…), conteos ("cuántos"), listados completos, rankings ("el más/menos…") o para confirmar si algo existe o no.
- Los resultados de las herramientas son exactos y cubren todo el catálogo: si difieren del <contexto>, confía en las herramientas.
- Si una consulta devuelve muchos productos, resume con conteos agrupados (por ejemplo por Nombre) y da algunos ejemplos con su código.
- Cita los productos devueltos por buscar_productos con su número de fuente [n].`;

  return { totalProducts: count, declarations, instructions };
}

function describeFilters(args: Record<string, unknown>): string {
  const filtros = Array.isArray(args.filtros) ? (args.filtros as Array<Record<string, unknown>>) : [];
  const parts = filtros.map((f) => `${f.campo} ${OP_LABEL[String(f.operador)] ?? f.operador} ${f.valor}`);
  if (args.agrupar_por) parts.push(`agrupado por ${args.agrupar_por}`);
  if (args.ordenar_por) parts.push(`ordenado por ${args.ordenar_por} ${args.orden === 'desc' ? '↓' : '↑'}`);
  return parts.join(' · ') || 'todo el catálogo';
}

/**
 * Ejecuta una herramienta del catálogo con el cliente del usuario (RLS) y
 * registra fuentes para los productos devueltos.
 */
export function createCatalogExecutor(
  db: SupabaseClient,
  projectId: string,
  sources: Source[],
  calls: CatalogToolCall[],
) {
  return async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const params = {
      p_project_id: projectId,
      p_filters: Array.isArray(args.filtros) ? args.filtros : [],
      p_order_by: name === 'buscar_productos' ? (args.ordenar_por ?? null) : null,
      p_order_dir: args.orden === 'desc' ? 'desc' : 'asc',
      p_limit: name === 'buscar_productos' ? Number(args.limite ?? 20) : 1,
      p_group_by: name === 'contar_productos' ? (args.agrupar_por ?? null) : null,
    };

    if (name !== 'contar_productos' && name !== 'buscar_productos') {
      return { error: `Herramienta desconocida: ${name}` };
    }

    const { data, error } = await db.rpc('search_catalog', params);
    const summary = describeFilters(args);
    if (error) {
      calls.push({ name, args, total: null, summary, error: error.message });
      return { error: error.message };
    }

    const result = data as {
      total: number;
      productos?: Array<{ nombre: string; codigo: string | null; atributos: Record<string, string> }>;
      grupos?: unknown;
      total_grupos?: number;
    };
    calls.push({ name, args, total: result.total, summary });

    if (name === 'contar_productos') {
      // Para contar no hace falta devolver productos completos.
      return { total: result.total, total_grupos: result.total_grupos, grupos: result.grupos };
    }

    const productos = (result.productos ?? []).map((p, i) => {
      let fuente: number | undefined;
      if (i < MAX_PRODUCTS_AS_SOURCES) {
        fuente = sources.length + 1;
        const attrs = Object.entries(p.atributos)
          .filter(([k]) => k !== 'Nombre' && k !== 'Código')
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · ');
        sources.push({
          index: fuente,
          documentId: '',
          documentName: 'Catálogo',
          chunkIndex: -1,
          kind: 'catalog',
          snippet: `${p.nombre}${p.codigo ? ` (${p.codigo})` : ''} — ${attrs}`.slice(0, 280),
        });
      }
      const { Nombre: _n, ['Código']: _c, ...rest } = p.atributos;
      return { fuente, nombre: p.nombre, codigo: p.codigo, ...rest };
    });
    return { total: result.total, mostrados: productos.length, productos };
  };
}
