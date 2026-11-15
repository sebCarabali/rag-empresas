import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { describeFailure, type LlmEvent, type LlmRoute, type ModelEvent } from '../../domain/llm/llm';
import type { LlmProvider } from '../../domain/models/catalog';
import { OpenAiCompatibleChatModel, readSse } from '../../infrastructure/llm/openai-compatible-chat-model';
import { GROQ_DIALECT, MISTRAL_DIALECT } from '../../infrastructure/llm/openai-dialects';
import type { ChatModel, ChatRequest } from '../ports';
import { ChatModelRegistry } from './chat-model-registry';
import { LlmService } from './llm.service';

const config = (timeout = 1000) => ({ geminiFirstEventTimeoutMs: timeout }) as never;

/** Adaptador falso (implementa el puerto ChatModel). */
function fakeModel(provider: LlmProvider, events: ModelEvent[], failWith?: Error, hangMs = 0) {
  const calls: ChatRequest[] = [];
  const model: ChatModel = {
    provider,
    async *stream(req) {
      calls.push(req);
      if (hangMs) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, hangMs);
          req.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        });
      }
      for (const e of events) yield e;
      if (failWith) throw failWith;
    },
  };
  return { model, calls };
}

function service(models: ChatModel[], timeout?: number) {
  return new LlmService(new ChatModelRegistry(models), config(timeout));
}

const ROUTE: LlmRoute = {
  primary: { provider: 'gemini', model: 'gemini-test', apiKey: 'g', keyOwner: 'company' },
  fallback: { provider: 'groq', model: 'openai/gpt-oss-120b', apiKey: 'q', keyOwner: 'company' },
};

async function collect(gen: AsyncGenerator<LlmEvent>) {
  const out: LlmEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const text = (events: LlmEvent[]) =>
  events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');

test('sin errores responde el principal, con su modelo y clave', async () => {
  const gemini = fakeModel('gemini', [{ type: 'text', text: 'hola' }]);
  const events = await collect(service([gemini.model]).run('s', [], { route: ROUTE }));
  assert.deepEqual(events[0], { type: 'model', info: { provider: 'gemini', model: 'gemini-test', fallback: false, keyOwner: 'company' } });
  assert.equal(text(events), 'hola');
  assert.equal(gemini.calls[0].model, 'gemini-test');
  assert.equal(gemini.calls[0].apiKey, 'g');
});

test('si el principal falla, responde el respaldo e informa el motivo', async () => {
  const quota = Object.assign(new Error('RESOURCE_EXHAUSTED: quota exceeded'), { status: 429 });
  const gemini = fakeModel('gemini', [], quota);
  const groq = fakeModel('groq', [{ type: 'text', text: 'respuesta de groq' }]);
  const events = await collect(service([gemini.model, groq.model]).run('s', [], { route: ROUTE }));
  const models = events.filter((e) => e.type === 'model');
  assert.deepEqual((models[1] as { info: unknown }).info, {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    fallback: true,
    reason: 'Gemini agotó su cuota',
    keyOwner: 'company',
  });
  assert.equal(text(events), 'respuesta de groq');
  assert.equal(groq.calls[0].apiKey, 'q');
});

test('si el principal falla a mitad de la respuesta, se descarta lo parcial', async () => {
  const gemini = fakeModel('gemini', [{ type: 'text', text: 'parcial…' }], new Error('503 UNAVAILABLE'));
  const groq = fakeModel('groq', [{ type: 'text', text: 'completa' }]);
  const events = await collect(service([gemini.model, groq.model]).run('s', [], { route: ROUTE }));
  assert.deepEqual(events.map((e) => e.type), ['model', 'text', 'reset', 'model', 'text']);
});

test('decorador de tiempo límite: si el principal no empieza a tiempo, pasa al respaldo', async () => {
  const gemini = fakeModel('gemini', [{ type: 'text', text: 'lento' }], undefined, 5000);
  const groq = fakeModel('groq', [{ type: 'text', text: 'rápido' }]);
  const events = await collect(service([gemini.model, groq.model], 50).run('s', [], { route: ROUTE }));
  assert.equal(text(events), 'rápido');
  assert.equal((events[1] as { info: { reason: string } }).info.reason, 'Gemini no respondió a tiempo');
});

test('si el usuario cancela, no se usa el respaldo', async () => {
  const abort = new AbortController();
  abort.abort();
  const gemini = fakeModel('gemini', [], new Error('aborted'));
  const groq = fakeModel('groq', [{ type: 'text', text: 'x' }]);
  await assert.rejects(collect(service([gemini.model, groq.model]).run('s', [], { route: ROUTE, signal: abort.signal })));
  assert.equal(groq.calls.length, 0);
});

test('sin respaldo, o con allowFallback=false, el error del principal se propaga', async () => {
  const gemini = fakeModel('gemini', [], new Error('500 internal'));
  const groq = fakeModel('groq', [{ type: 'text', text: 'x' }]);
  const llm = service([gemini.model, groq.model]);
  await assert.rejects(collect(llm.run('s', [], { route: { ...ROUTE, fallback: null } })));
  await assert.rejects(collect(llm.run('s', [], { route: ROUTE, allowFallback: false })));
  assert.equal(groq.calls.length, 0);
});

test('ruta elegida: Mistral principal con respaldo en OpenAI', async () => {
  const mistral = fakeModel('mistral', [], Object.assign(new Error('Mistral 401: Unauthorized'), { status: 401 }));
  const openai = fakeModel('openai', [{ type: 'text', text: 'desde openai' }]);
  const events = await collect(
    service([mistral.model, openai.model]).run('s', [], {
      route: {
        primary: { provider: 'mistral', model: 'mistral-medium-latest', apiKey: 'm', keyOwner: 'company' },
        fallback: { provider: 'openai', model: 'gpt-5.4-mini', apiKey: 'o', keyOwner: 'company' },
      },
    }),
  );
  assert.equal(text(events), 'desde openai');
  assert.equal(
    (events.filter((e) => e.type === 'model')[1] as { info: { reason: string } }).info.reason,
    'la clave de Mistral no es válida o no tiene permisos',
  );
});

test('el registro falla con un proveedor sin adaptador', () => {
  assert.throws(() => new ChatModelRegistry([]).get('mistral'), /mistral/);
});

test('describeFailure traduce los errores habituales', () => {
  assert.equal(describeFailure(new Error('401 API key not valid')), 'la clave de Gemini no es válida o no tiene permisos');
  assert.equal(describeFailure(new Error('fetch failed'), 'mistral'), 'no se pudo conectar con Mistral');
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

/** Ejecuta el adaptador compatible con OpenAI contra respuestas SSE simuladas. */
async function runAdapter(dialect: typeof GROQ_DIALECT, responses: ReadableStream<Uint8Array>[], model: string) {
  const bodies: Array<Record<string, any>> = [];
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    urls.push(url);
    bodies.push(JSON.parse(init.body));
    return new Response(responses[bodies.length - 1], { status: 200 });
  }) as typeof fetch;
  try {
    const executed: Array<[string, unknown]> = [];
    let out = '';
    for await (const e of new OpenAiCompatibleChatModel(dialect).stream({
      systemInstruction: 'sys',
      turns: [{ role: 'user', content: 'cuántas' }],
      model,
      apiKey: 'k',
      tools: [{ name: 'contar_productos', description: 'd', parametersJsonSchema: { type: 'object' } }],
      execute: async (name: string, args: Record<string, unknown>) => {
        executed.push([name, args]);
        return { total: 722 };
      },
    })) {
      if (e.type === 'text') out += e.text;
    }
    return { bodies, urls, executed, out };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('Groq: acumula la llamada a herramienta, la ejecuta y luego responde', async () => {
  const { bodies, urls, executed, out } = await runAdapter(
    GROQ_DIALECT,
    [
      sseStream([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'contar_', arguments: '{"filtros":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'productos', arguments: '[]}' } }] } }] },
      ]),
      sseStream([{ choices: [{ delta: { content: 'Hay 722.' } }] }]),
    ],
    'openai/gpt-oss-120b',
  );
  assert.equal(urls[0], 'https://api.groq.com/openai/v1/chat/completions');
  assert.deepEqual(executed, [['contar_productos', { filtros: [] }]]);
  assert.equal(out, 'Hay 722.');
  assert.equal(bodies[0].tools[0].function.name, 'contar_productos');
  assert.equal(bodies[0].reasoning_effort, 'low');
  assert.deepEqual(bodies[0].stream_options, { include_usage: true });
  assert.deepEqual(bodies[1].messages.at(-1), { role: 'tool', tool_call_id: 'c1', content: '{"total":722}' });
});

test('Mistral: llamadas completas sin "index", sin stream_options y con el nombre en el resultado', async () => {
  const { bodies, urls, executed, out } = await runAdapter(
    MISTRAL_DIALECT,
    [
      sseStream([
        { choices: [{ delta: { tool_calls: [{ id: 'a1', function: { name: 'contar_productos', arguments: '{"filtros":[]}' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ id: 'a2', function: { name: 'contar_productos', arguments: '{}' } }] } }] },
      ]),
      sseStream([{ choices: [{ delta: { content: 'Listo.' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }]),
    ],
    'mistral-medium-latest',
  );
  assert.equal(urls[0], 'https://api.mistral.ai/v1/chat/completions');
  assert.equal(bodies[0].stream_options, undefined);
  assert.equal(bodies[0].reasoning_effort, undefined);
  assert.equal(executed.length, 2, 'cada llamada sin index es una llamada distinta');
  assert.equal(out, 'Listo.');
  assert.deepEqual(bodies[1].messages.at(-1), { role: 'tool', tool_call_id: 'a2', content: '{"total":722}', name: 'contar_productos' });
});
