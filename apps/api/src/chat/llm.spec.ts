import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { GeminiEvent } from './gemini.service';
import { GroqService, readSse } from './groq.service';
import { describeFailure, LlmService, type LlmEvent } from './llm.service';

process.env.SUPABASE_URL ??= 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'x';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_test';
process.env.GEMINI_API_KEY ??= 'x';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppConfig } = require('../config/app-config');

function config(overrides: Record<string, unknown> = {}) {
  return Object.assign(new AppConfig(), { groqApiKey: 'gsk_test', geminiFirstEventTimeoutMs: 1000, ...overrides });
}

function fakeProvider(events: GeminiEvent[], failWith?: Error, hangMs = 0) {
  return {
    async *run(_s: string, _t: unknown, opts: { signal?: AbortSignal }) {
      if (hangMs) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, hangMs);
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        });
      }
      for (const e of events) yield e;
      if (failWith) throw failWith;
    },
  };
}

async function collect(gen: AsyncGenerator<LlmEvent>) {
  const out: LlmEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const text = (events: LlmEvent[]) =>
  events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');

test('sin errores responde Gemini y no cambia de modelo', async () => {
  const cfg = config();
  const llm = new LlmService(fakeProvider([{ type: 'text', text: 'hola' }]) as never, new GroqService(cfg), cfg);
  const events = await collect(llm.run('s', []));
  assert.deepEqual(events[0], { type: 'model', info: { provider: 'gemini', model: cfg.geminiModel, fallback: false, keyOwner: 'platform' } });
  assert.equal(text(events), 'hola');
});

test('si Gemini falla, responde Groq e informa el motivo', async () => {
  const cfg = config();
  const quota = Object.assign(new Error('RESOURCE_EXHAUSTED: quota exceeded'), { status: 429 });
  const groq = Object.assign(fakeProvider([{ type: 'text', text: 'respuesta de groq' }]), { enabled: true, model: 'openai/gpt-oss-120b' });
  const llm = new LlmService(fakeProvider([], quota) as never, groq as never, cfg);
  const events = await collect(llm.run('s', []));
  const models = events.filter((e) => e.type === 'model');
  assert.equal(models.length, 2);
  assert.deepEqual((models[1] as { info: unknown }).info, {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    fallback: true,
    reason: 'Gemini agotó su cuota',
  });
  assert.equal(text(events), 'respuesta de groq');
});

test('si Gemini falla a mitad de la respuesta, se descarta lo parcial', async () => {
  const cfg = config();
  const groq = Object.assign(fakeProvider([{ type: 'text', text: 'completa' }]), { enabled: true, model: 'g' });
  const llm = new LlmService(fakeProvider([{ type: 'text', text: 'parcial…' }], new Error('503 UNAVAILABLE')) as never, groq as never, cfg);
  const events = await collect(llm.run('s', []));
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['model', 'text', 'reset', 'model', 'text']);
});

test('si Gemini no empieza a responder a tiempo, pasa a Groq', async () => {
  const cfg = config({ geminiFirstEventTimeoutMs: 50 });
  const groq = Object.assign(fakeProvider([{ type: 'text', text: 'rápido' }]), { enabled: true, model: 'g' });
  const llm = new LlmService(fakeProvider([{ type: 'text', text: 'lento' }], undefined, 5000) as never, groq as never, cfg);
  const events = await collect(llm.run('s', []));
  assert.equal(text(events), 'rápido');
  assert.equal((events[1] as { info: { reason: string } }).info.reason, 'Gemini no respondió a tiempo');
});

test('si el usuario cancela, no se usa el respaldo', async () => {
  const cfg = config();
  const abort = new AbortController();
  abort.abort();
  const groq = Object.assign(fakeProvider([{ type: 'text', text: 'x' }]), { enabled: true, model: 'g' });
  const llm = new LlmService(fakeProvider([], new Error('aborted')) as never, groq as never, cfg);
  await assert.rejects(collect(llm.run('s', [], { signal: abort.signal })));
});

test('sin clave de Groq, el error de Gemini se propaga', async () => {
  const cfg = config({ groqApiKey: '' });
  const llm = new LlmService(fakeProvider([], new Error('500 internal')) as never, new GroqService(cfg), cfg);
  await assert.rejects(collect(llm.run('s', [])));
});

test('describeFailure traduce los errores habituales', () => {
  assert.equal(describeFailure(new Error('401 API key not valid')), 'la clave de Gemini no es válida o no tiene permisos');
  assert.equal(describeFailure(new Error('fetch failed')), 'no se pudo conectar con Gemini');
});

function sseStream(events: unknown[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
  // Se parte en trozos arbitrarios para probar el armado del buffer.
  const chunks = body.match(/[\s\S]{1,17}/g) ?? [];
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

test('readSse arma los eventos aunque lleguen partidos', async () => {
  const deltas = [];
  for await (const d of readSse(sseStream([{ choices: [{ delta: { content: 'Ho' } }] }, { choices: [{ delta: { content: 'la' } }] }]))) {
    deltas.push(d);
  }
  assert.deepEqual(deltas, [{ content: 'Ho' }, { content: 'la' }]);
});

test('Groq: acumula la llamada a herramienta, la ejecuta y luego responde', async () => {
  const cfg = config();
  const groq = new GroqService(cfg);
  const bodies: Array<Record<string, any>> = [];
  const responses = [
    sseStream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'contar_', arguments: '{"filtros":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'productos', arguments: '[]}' } }] } }] },
    ]),
    sseStream([{ choices: [{ delta: { content: 'Hay 722.' } }] }]),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(responses[bodies.length - 1], { status: 200 });
  }) as typeof fetch;
  try {
    const executed: Array<[string, unknown]> = [];
    let out = '';
    for await (const e of groq.run('sys', [{ role: 'user', content: 'cuántas' }], {
      tools: [{ name: 'contar_productos', description: 'd', parametersJsonSchema: { type: 'object' } }],
      execute: async (name, args) => {
        executed.push([name, args]);
        return { total: 722 };
      },
    })) {
      if (e.type === 'text') out += e.text;
    }
    assert.deepEqual(executed, [['contar_productos', { filtros: [] }]]);
    assert.equal(out, 'Hay 722.');
    assert.equal(bodies[0].tools[0].function.name, 'contar_productos');
    assert.equal(bodies[0].reasoning_effort, 'low');
    assert.deepEqual(bodies[1].messages.at(-1), { role: 'tool', tool_call_id: 'c1', content: '{"total":722}' });
    assert.equal(bodies[1].messages.at(-2).tool_calls[0].function.arguments, '{"filtros":[]}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('con allowFallback=false no se usa Groq aunque haya clave', async () => {
  const cfg = config();
  const groq = Object.assign(fakeProvider([{ type: 'text', text: 'groq' }]), { enabled: true, model: 'g' });
  const llm = new LlmService(fakeProvider([], new Error('503 UNAVAILABLE')) as never, groq as never, cfg);
  await assert.rejects(collect(llm.run('s', [], { allowFallback: false })));
});
