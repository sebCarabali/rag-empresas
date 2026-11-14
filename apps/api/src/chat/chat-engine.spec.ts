import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChatEngineService } from './chat-engine.service';
import type { LlmEvent } from './llm.service';

/** Cliente de Supabase falso: cualquier consulta devuelve vacío. */
function fakeDb() {
  const empty = { data: [], count: 0, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve(empty);
  return { from: () => chain, rpc: async () => ({ data: [], error: null }) };
}

function engineWith(events: LlmEvent[]) {
  const puts: Array<Record<string, unknown>> = [];
  const cache = {
    enabled: true,
    contentVersion: async () => 'v1',
    key: () => 'clave',
    get: async () => null,
    put: async (_k: string, _p: string, _q: string, value: Record<string, unknown>) => {
      puts.push(value);
    },
  };
  const llm = {
    async *run() {
      for (const e of events) yield e;
    },
  };
  const engine = new ChatEngineService(
    { embedQuery: async () => [0.1, 0.2] } as never,
    llm as never,
    cache as never,
    { getGeminiKey: async () => null } as never,
  );
  return { engine, puts };
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
