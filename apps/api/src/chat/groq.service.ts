import { Injectable } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { AppConfig } from '../config/app-config';
import type { ChatTurn, GeminiEvent, ToolExecutor } from './gemini.service';

import { OPENAI_COMPATIBLE_BASE } from '../models/catalog';
const MAX_TOOL_ROUNDS = 4;

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
}

/** Proveedor y credenciales de una llamada compatible con OpenAI. */
export interface OpenAiTarget {
  provider: 'groq' | 'openai';
  model: string;
  apiKey: string;
}

/**
 * Modelos con API compatible con OpenAI (Groq y OpenAI). Misma interfaz que
 * GeminiService: streaming de texto y llamadas a las herramientas del catálogo.
 * Sin "target" usa Groq con la clave y el modelo de la plataforma.
 */
@Injectable()
export class GroqService {
  constructor(private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.groqApiKey);
  }

  get model(): string {
    return this.config.groqModel;
  }

  async *run(
    systemInstruction: string,
    turns: ChatTurn[],
    options: { tools?: FunctionDeclaration[]; execute?: ToolExecutor; signal?: AbortSignal; target?: OpenAiTarget } = {},
  ): AsyncGenerator<GeminiEvent> {
    const target: OpenAiTarget = options.target ?? { provider: 'groq', model: this.config.groqModel, apiKey: this.config.groqApiKey };
    const label = target.provider === 'openai' ? 'OpenAI' : 'Groq';
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
        model: target.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (useTools) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }
      // Los modelos gpt-oss razonan antes de responder; "low" mantiene la latencia baja.
      if (target.model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';

      const res = await fetch(`${OPENAI_COMPATIBLE_BASE[target.provider]}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${target.apiKey}`, 'Content-Type': 'application/json' },
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
          const current = calls.get(tc.index) ?? { id: '', name: '', arguments: '' };
          if (tc.id) current.id = tc.id;
          if (tc.function?.name) current.name += tc.function.name;
          if (tc.function?.arguments) current.arguments += tc.function.arguments;
          calls.set(tc.index, current);
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
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
  }
}

interface SseDelta {
  content?: string | null;
  /** Solo en el último evento (stream_options.include_usage). */
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
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
