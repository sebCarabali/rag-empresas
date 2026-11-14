import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AnswerCacheService } from './answer-cache.service';
import { GeminiService, type GeminiEvent } from './gemini.service';
import { diversify, type RetrievedChunk } from './prompt';

function chunk(id: string, title: string, format?: string): RetrievedChunk {
  return {
    id,
    document_id: 'doc',
    chunk_index: 0,
    content: `${title}\nCódigo: ${id}`,
    metadata: format ? ({ format } as RetrievedChunk['metadata']) : {},
    score: 1,
  };
}

test('diversify: máximo 2 fragmentos por producto de CSV', () => {
  const input = [
    chunk('a1', 'Keiraplus 160', 'csv'),
    chunk('a2', 'Keiraplus 160', 'csv'),
    chunk('a3', 'Keiraplus 160', 'csv'),
    chunk('b1', 'Oxford160', 'csv'),
    chunk('a4', 'Keiraplus 160', 'csv'),
    chunk('c1', 'Kendal', 'csv'),
  ];
  assert.deepEqual(diversify(input, 4).map((c) => c.id), ['a1', 'a2', 'b1', 'c1']);
});

test('diversify: completa con descartados si no alcanza y no limita textos', () => {
  const input = [chunk('a1', 'X', 'csv'), chunk('a2', 'X', 'csv'), chunk('a3', 'X', 'csv'), chunk('t1', 'Manual'), chunk('t2', 'Manual')];
  assert.deepEqual(diversify(input, 5).map((c) => c.id), ['a1', 'a2', 't1', 't2', 'a3']);
});

test('normalizeQuestion ignora tildes, mayúsculas y signos', () => {
  assert.equal(
    AnswerCacheService.normalizeQuestion('¿Cuántas telas de ALGODÓN hay?'),
    AnswerCacheService.normalizeQuestion('cuantas telas de algodon hay'),
  );
});

/** Simula el streaming de Gemini: cada elemento de `rounds` es una respuesta del modelo. */
function fakeGemini(rounds: Array<Array<Record<string, unknown>>>) {
  process.env.SUPABASE_URL ??= 'https://x.supabase.co';
  process.env.SUPABASE_ANON_KEY ??= 'x';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_test';
  process.env.GEMINI_API_KEY ??= 'x';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppConfig } = require('../config/app-config');
  const service = new GeminiService(new AppConfig());
  const requests: Array<Record<string, unknown>> = [];
  (service as unknown as { ai: unknown }).ai = {
    models: {
      generateContentStream: async (req: Record<string, unknown>) => {
        requests.push(structuredClone({ ...req, config: { ...(req.config as object), abortSignal: undefined } }));
        const parts = rounds[requests.length - 1] ?? [{ text: 'fin' }];
        return (async function* () {
          for (const part of parts) yield { candidates: [{ content: { parts: [part] } }] };
        })();
      },
    },
  };
  return { service, requests };
}

test('Gemini: ejecuta la herramienta, devuelve el resultado y luego responde', async () => {
  const { service, requests } = fakeGemini([
    [{ functionCall: { id: 'c1', name: 'contar_productos', args: { filtros: [] } }, thoughtSignature: 'sig' }],
    [{ text: 'Hay ' }, { text: '722 telas.' }],
  ]);
  const executed: string[] = [];
  const events: GeminiEvent[] = [];
  for await (const e of service.run('sys', [{ role: 'user', content: 'cuántas' }], {
    tools: [{ name: 'contar_productos' }],
    execute: async (name) => {
      executed.push(name);
      return { total: 722 };
    },
  })) {
    events.push(e);
  }

  assert.deepEqual(executed, ['contar_productos']);
  assert.equal(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join(''), 'Hay 722 telas.');
  // La segunda llamada lleva la parte del modelo (con su firma) y la respuesta de la función.
  const contents = requests[1].contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
  assert.equal(contents[1].role, 'model');
  assert.equal(contents[1].parts[0].thoughtSignature, 'sig');
  assert.deepEqual(contents[2].parts[0].functionResponse, { id: 'c1', name: 'contar_productos', response: { total: 722 } });
});

test('Gemini: tras el máximo de rondas fuerza la respuesta sin herramientas', async () => {
  const call = [{ functionCall: { name: 'contar_productos', args: {} } }];
  const { service, requests } = fakeGemini([call, call, call, call, [{ text: 'listo' }]]);
  let text = '';
  for await (const e of service.run('sys', [{ role: 'user', content: 'x' }], {
    tools: [{ name: 'contar_productos' }],
    execute: async () => ({ total: 1 }),
  })) {
    if (e.type === 'text') text += e.text;
  }
  assert.equal(text, 'listo');
  assert.equal(requests.length, 5);
  assert.equal((requests[4].config as { tools?: unknown }).tools, undefined);
});

test('Gemini: no reenvía el texto de "pensamiento" al usuario', async () => {
  const { service } = fakeGemini([[{ text: 'razonando…', thought: true }, { text: 'respuesta' }]]);
  let text = '';
  for await (const e of service.run('sys', [{ role: 'user', content: 'x' }])) if (e.type === 'text') text += e.text;
  assert.equal(text, 'respuesta');
});

test('herramienta de catálogo: arma los parámetros del RPC y registra fuentes', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCatalogExecutor } = require('./catalog-tools');
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const db = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push([fn, params]);
      return {
        data: {
          total: 722,
          productos: [{ nombre: 'Rumana', codigo: 'RUM_1', atributos: { Nombre: 'Rumana', 'Código': 'RUM_1', Peso: '95 g/m² (±7%)' } }],
        },
        error: null,
      };
    },
  };
  const sources: Array<Record<string, unknown>> = [{ index: 1 }];
  const calls: Array<Record<string, unknown>> = [];
  const exec = createCatalogExecutor(db, 'p1', sources, calls);
  const result = await exec('buscar_productos', {
    filtros: [{ campo: 'Peso', operador: 'menor', valor: '120' }],
    ordenar_por: 'Peso',
    orden: 'asc',
    limite: 5,
  });

  assert.equal(rpcCalls[0][0], 'search_catalog');
  assert.deepEqual(rpcCalls[0][1], {
    p_project_id: 'p1',
    p_filters: [{ campo: 'Peso', operador: 'menor', valor: '120' }],
    p_order_by: 'Peso',
    p_order_dir: 'asc',
    p_limit: 5,
    p_group_by: null,
  });
  assert.deepEqual(result.productos, [{ fuente: 2, nombre: 'Rumana', codigo: 'RUM_1', Peso: '95 g/m² (±7%)' }]);
  assert.equal(sources.length, 2);
  assert.equal(sources[1].documentName, 'Catálogo');
  assert.equal(calls[0].summary, 'Peso < 120 · ordenado por Peso ↑');
  assert.equal(calls[0].total, 722);
});

test('loadEnrichments: prioriza lo mencionado en la pregunta y lo presente en los productos', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadEnrichments } = require('./enrichment-context');
  const rows = [
    { field: 'Familia', value: 'Chalis', description: 'Tela fluida de viscosa…', sources: [] },
    { field: 'Familia', value: 'Linos', description: 'Tela fresca…', sources: [] },
    { field: 'Tipo de tejido', value: 'Plano', description: 'Tejido de urdimbre y trama…', sources: [] },
    { field: 'Familia', value: 'Jacquard', description: 'Con dibujo tejido…', sources: [] },
  ];
  const query = { eq: () => query, limit: async () => ({ data: rows, error: null }) };
  const db = { from: () => ({ select: () => query }) };
  const chunks = [
    { content: 'Tela A\nFamilia: Linos\nTipo de tejido: Plano' },
    { content: 'Tela B\nFamilia: Linos\nTipo de tejido: Plano' },
  ];
  const result = await loadEnrichments(db, 'p1', '¿Qué es el chalis y para qué sirve?', chunks);
  assert.deepEqual(
    result.map((r: { value: string }) => r.value),
    ['Chalis', 'Linos', 'Plano'],
  );
});

test('isFollowUp: la primera pregunta nunca es de seguimiento', () => {
  assert.equal(AnswerCacheService.isFollowUp('¿y en tejido plano?', false), false);
});

test('isFollowUp: detecta preguntas que dependen de la conversación', () => {
  for (const q of [
    '¿Y en tejido plano?',
    'y cuales son de algodón',
    '¿Cuál de esas es la más liviana?',
    'dame más',
    'también para niños',
    '¿Qué peso tiene la anterior?',
    'Compara las dos primeras',
    '¿Por qué?',
  ]) {
    assert.equal(AnswerCacheService.isFollowUp(q, true), true, q);
  }
});

test('isFollowUp: las preguntas que se entienden solas sí usan caché', () => {
  for (const q of [
    'dame información de la popelina',
    '¿Qué telas de algodón 100% hay para niños?',
    '¿Cuánto pesa la Zupla B?',
    'Telas florales en punto de Modateks',
    '¿Cómo se lava el lino?',
  ]) {
    assert.equal(AnswerCacheService.isFollowUp(q, true), false, q);
  }
});
