import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChatEngineService } from './chat-engine.service';
import type { LlmEvent } from '../llm/llm.service';

/** Cliente de Supabase falso: cualquier consulta devuelve vacío. */
function fakeDb() {
  const empty = { data: [], count: 0, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve(empty);
  return { from: () => chain, rpc: async () => ({ data: [], error: null }) };
}

function engineWith(
  events: LlmEvent[],
  options: {
    cached?: Record<string, unknown>;
    geminiFails?: boolean;
    similar?: Array<{ cache_key: string; question: string; similarity: number }>;
    vocabulary?: string[];
  } = {},
) {
  const puts: Array<Record<string, unknown>> = [];
  const recorded: Array<Record<string, unknown>> = [];
  const runs: Array<Record<string, unknown>> = [];
  const cache = {
    enabled: true,
    contentVersion: async () => 'v1',
    key: () => 'clave',
    semanticEnabled: Boolean(options.similar),
    // La entrada exacta no existe cuando se prueba la caché por significado.
    get: async (key: string) => (options.similar ? (key === 'parecida' ? options.cached : null) : (options.cached ?? null)),
    similar: async () => options.similar ?? [],
    vocabulary: async () => new Set(options.vocabulary ?? []),
    put: async (_k: string, _p: string, _q: string, value: Record<string, unknown>) => {
      puts.push(value);
    },
  };
  const llm = {
    async *run(_s: string, _t: unknown, opts: Record<string, unknown>) {
      runs.push(opts);
      if (options.geminiFails && opts.allowFallback === false) throw new Error('503 UNAVAILABLE');
      for (const e of events) yield e;
    },
  };
  const engine = new ChatEngineService(
    { embedQuery: async () => [0.1, 0.2], modelId: () => 'modelo-test' } as never,
    llm as never,
    cache as never,
    { record: async (e: Record<string, unknown>) => void recorded.push(e) } as never,
    { rerank: async (_q: string, items: unknown[]) => ({ items, reranked: false, ms: 0 }) } as never,
    { ensureCurrent: async () => undefined } as never,
    {
      get: async () => ({ llmProvider: 'gemini', llmModel: null, llmFallback: 'groq', llmFallbackModel: null, embeddingModel: null }),
      route: async () => ({
        primary: { provider: 'gemini', model: 'gemini-test', apiKey: 'k', keyOwner: 'platform' },
        fallback: null,
      }),
    } as never,
  );
  return { engine, puts, runs, recorded };
}

const input = () => ({
  db: fakeDb() as never,
  projectId: 'p1',
  companyId: 'c1',
  question: '¿Qué telas de algodón hay?',
  history: [],
  bot: null,
  emit: () => undefined,
  signal: new AbortController().signal,
});

test('cachea la respuesta de Gemini', async () => {
  const { engine, puts } = engineWith([
    { type: 'model', info: { provider: 'gemini', model: 'gemini-3.5-flash', fallback: false } },
    { type: 'text', text: 'Respuesta de Gemini' },
  ]);
  await engine.ask(input());
  assert.equal(puts.length, 1);
  assert.equal(puts[0].answer, 'Respuesta de Gemini');
});

test('cachea también la respuesta del respaldo (Groq) con su modelo', async () => {
  const { engine, puts } = engineWith([
    { type: 'model', info: { provider: 'gemini', model: 'gemini-3.5-flash', fallback: false } },
    { type: 'model', info: { provider: 'groq', model: 'openai/gpt-oss-120b', fallback: true, reason: 'Gemini agotó su cuota' } },
    { type: 'text', text: 'Respuesta de Groq' },
  ]);
  await engine.ask(input());
  assert.equal(puts.length, 1);
  assert.equal(puts[0].answer, 'Respuesta de Groq');
  assert.deepEqual((puts[0].modelInfo as { provider: string }).provider, 'groq');
});

test('no cachea respuestas vacías', async () => {
  const { engine, puts } = engineWith([{ type: 'model', info: { provider: 'gemini', model: 'g', fallback: false } }]);
  await engine.ask(input());
  assert.equal(puts.length, 0);
});

const groqCached = {
  answer: 'Respuesta guardada de Groq',
  sources: [],
  toolCalls: [],
  modelInfo: { provider: 'groq', model: 'openai/gpt-oss-120b', fallback: true, reason: 'Gemini agotó su cuota' },
};

test('una respuesta de Gemini en caché se entrega sin llamar al modelo', async () => {
  const { engine, runs } = engineWith([], {
    cached: { ...groqCached, answer: 'De Gemini', modelInfo: { provider: 'gemini', model: 'g', fallback: false } },
  });
  const result = await engine.ask(input());
  assert.equal(result.cached, true);
  assert.equal(result.answer, 'De Gemini');
  assert.equal(runs.length, 0);
});

test('con una respuesta de Groq en caché, si Gemini responde la reemplaza', async () => {
  const { engine, puts, runs } = engineWith(
    [
      { type: 'model', info: { provider: 'gemini', model: 'gemini-3.5-flash', fallback: false } },
      { type: 'text', text: 'Nueva de Gemini' },
    ],
    { cached: groqCached },
  );
  const result = await engine.ask(input());
  assert.equal(runs[0].allowFallback, false); // solo Gemini, sin volver a Groq
  assert.equal(result.cached, false);
  assert.equal(result.answer, 'Nueva de Gemini');
  assert.equal(puts.length, 1);
  assert.equal((puts[0].modelInfo as { provider: string }).provider, 'gemini');
});

test('con una respuesta de Groq en caché, si Gemini sigue fallando se entrega la guardada', async () => {
  const { engine, puts } = engineWith([], { cached: groqCached, geminiFails: true });
  const events: Array<{ type: string }> = [];
  const result = await engine.ask({ ...input(), emit: (e: object) => events.push(e as { type: string }) });
  assert.equal(result.cached, true);
  assert.equal(result.answer, 'Respuesta guardada de Groq');
  assert.equal(puts.length, 0);
  assert.ok(events.some((e) => e.type === 'reset'));
});

test('sin caché previa se permite el respaldo en Groq', async () => {
  const { engine, runs } = engineWith([{ type: 'text', text: 'x' }]);
  await engine.ask(input());
  assert.equal(runs[0].allowFallback, true);
});

test('caché por significado: reutiliza una pregunta parecida con los mismos términos', async () => {
  const cached = { answer: 'Hay 166 telas.', sources: [], toolCalls: [], modelInfo: { provider: 'gemini', model: 'g', fallback: false } };
  const { engine, runs, recorded } = engineWith([], {
    cached,
    similar: [{ cache_key: 'parecida', question: 'telas de algodón para niños', similarity: 0.95 }],
    vocabulary: ['algodon'],
  });
  const result = await engine.ask({ ...input(), question: '¿Qué algodones tienen para bebés?' });
  assert.equal(result.cached, true);
  assert.equal(result.answer, 'Hay 166 telas.');
  assert.deepEqual(result.cacheMatch, { kind: 'semantic', question: 'telas de algodón para niños', similarity: 0.95 });
  assert.equal(runs.length, 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(recorded[0].cacheMatch, 'semantic');
});

test('caché por significado: descarta si cambia un término del catálogo', async () => {
  const cached = { answer: 'Algodón…', sources: [], toolCalls: [], modelInfo: { provider: 'gemini', model: 'g', fallback: false } };
  const { engine, runs } = engineWith(
    [
      { type: 'model', info: { provider: 'gemini', model: 'g', fallback: false } },
      { type: 'text', text: 'Poliéster…' },
      { type: 'usage', input: 1000, output: 200 },
    ],
    {
      cached,
      similar: [{ cache_key: 'parecida', question: 'telas de algodón para niños', similarity: 0.97 }],
      vocabulary: ['algodon', 'poliester'],
    },
  );
  const result = await engine.ask({ ...input(), question: 'telas de poliéster para niños' });
  assert.equal(result.cached, false);
  assert.equal(result.answer, 'Poliéster…');
  assert.deepEqual(result.usage, { input: 1000, output: 200 });
  assert.equal(runs.length, 1);
});

test('misma pregunta respondida por Gemini en el otro canal: se reutiliza sin llamar al modelo', async () => {
  const cached = { answer: 'Kafka es…', sources: [], toolCalls: [], modelInfo: { provider: 'gemini', model: 'g', fallback: false } };
  const { engine, runs } = engineWith([], {
    cached,
    similar: [{ cache_key: 'parecida', question: 'Cómo funciona Kafka', similarity: 0.999, variant: 'public' } as never],
    vocabulary: ['kafka'],
  });
  const result = await engine.ask({ ...input(), question: '¿cómo funciona kafka?' });
  assert.equal(result.cached, true);
  assert.equal(result.answer, 'Kafka es…');
  assert.equal(runs.length, 0);
});
