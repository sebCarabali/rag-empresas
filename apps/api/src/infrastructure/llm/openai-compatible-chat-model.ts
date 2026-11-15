import type { ChatModel, ChatRequest } from '../../application/ports';
import type { ModelEvent } from '../../domain/llm/llm';
import type { OpenAiDialect } from './openai-dialects';

const MAX_TOOL_ROUNDS = 4;

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string; name?: string };

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Adaptador (Strategy) del puerto ChatModel para APIs compatibles con OpenAI
 * (OpenAI, Groq, Mistral). Lo que cambia entre ellas está en el dialecto.
 * Streaming de texto y llamadas a las herramientas del catálogo; la clave es
 * siempre la del asistente.
 */
export class OpenAiCompatibleChatModel implements ChatModel {
  readonly provider: OpenAiDialect['provider'];

  constructor(private readonly dialect: OpenAiDialect) {
    this.provider = dialect.provider;
  }

  async *stream(options: ChatRequest): AsyncGenerator<ModelEvent> {
    const { systemInstruction, turns, model, apiKey } = options;
    const { label, baseUrl } = this.dialect;
    const messages: OpenAiMessage[] = [
      { role: 'system', content: systemInstruction },
      ...turns.map((t) => ({ role: t.role, content: t.content }) as OpenAiMessage),
    ];
    const tools = options.tools?.map((d) => ({
      type: 'function' as const,
      function: {
        name: d.name ?? '',
        description: d.description ?? '',
        parameters: (d.parametersJsonSchema as object) ?? { type: 'object', properties: {} },
      },
    }));
    const hasTools = Boolean(tools?.length && options.execute);

    for (let round = 0; ; round++) {
      const useTools = hasTools && round < MAX_TOOL_ROUNDS;
      const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
      };
      if (this.dialect.streamUsage) body.stream_options = { include_usage: true };
      if (useTools) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }
      this.dialect.customize?.(body, model);

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw Object.assign(new Error(`${label} ${res.status}: ${detail.slice(0, 300)}`), { status: res.status });
      }

      let content = '';
      const calls = new Map<number, PendingCall>();
      for await (const delta of readSse(res.body, label)) {
        if (delta.usage) {
          yield { type: 'usage', input: delta.usage.prompt_tokens ?? 0, output: delta.usage.completion_tokens ?? 0 };
          continue;
        }
        if (delta.content) {
          content += delta.content;
          yield { type: 'text', text: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          // Mistral manda cada llamada completa y sin "index": cada una es nueva.
          const index = tc.index ?? calls.size;
          const current = calls.get(index) ?? { id: '', name: '', arguments: '' };
          if (tc.id) current.id = tc.id;
          if (tc.function?.name) current.name += tc.function.name;
          if (tc.function?.arguments) current.arguments += tc.function.arguments;
          calls.set(index, current);
        }
      }

      if (!useTools || calls.size === 0) return;

      const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c], i) => ({ ...c, id: c.id || `call_${round}_${i}` }));
      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: ordered.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } })),
      });
      for (const call of ordered) {
        let args: Record<string, unknown> = {};
        let result: Record<string, unknown>;
        try {
          args = JSON.parse(call.arguments || '{}');
          result = await options.execute!(call.name, args);
        } catch (err) {
          result = { error: (err as Error).message };
        }
        yield { type: 'tool', name: call.name, args, result };
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
          ...(this.dialect.toolResultName ? { name: call.name } : {}),
        });
      }
    }
  }
}

interface SseDelta {
  content?: string | null;
  /** Solo en el último evento (stream_options.include_usage). */
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
}

/** Lee un stream SSE de chat completions y devuelve el "delta" de cada evento. */
export async function* readSse(body: ReadableStream<Uint8Array>, label = 'Groq'): AsyncGenerator<SseDelta> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';
    for (const event of events) {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const json = JSON.parse(data);
        if (json.error) throw new Error(`${label}: ${json.error.message ?? JSON.stringify(json.error)}`);
        const delta = json.choices?.[0]?.delta;
        if (delta) yield delta as SseDelta;
        const usage = json.usage;
        if (usage) yield { usage } as SseDelta;
      }
    }
  }
}
