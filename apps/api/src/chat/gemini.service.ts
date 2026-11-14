import { Injectable } from '@nestjs/common';
import { GoogleGenAI, type Content, type FunctionCall, type FunctionDeclaration, type Part } from '@google/genai';
import { AppConfig } from '../config/app-config';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export type GeminiEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; args: Record<string, unknown>; result: Record<string, unknown> };

/** Rondas máximas de llamadas a herramientas antes de forzar la respuesta final. */
const MAX_TOOL_ROUNDS = 4;

/** Clientes reutilizables por clave (la de la plataforma y las de cada empresa). */
const clients = new Map<string, GoogleGenAI>();
const MAX_CLIENTS = 100;

export function geminiClient(apiKey: string): GoogleGenAI {
  let client = clients.get(apiKey);
  if (!client) {
    if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value as string);
    client = new GoogleGenAI({ apiKey });
    clients.set(apiKey, client);
  }
  return client;
}

@Injectable()
export class GeminiService {
  /** Cliente con la clave de la plataforma (se puede reemplazar en pruebas). */
  private ai: GoogleGenAI;

  constructor(private readonly config: AppConfig) {
    this.ai = geminiClient(config.geminiApiKey);
  }

  /**
   * Genera la respuesta en streaming. Si se pasan herramientas, el modelo puede
   * llamarlas (p. ej. filtros exactos sobre el catálogo); se ejecutan y su
   * resultado vuelve al modelo hasta que produce la respuesta final.
   */
  async *run(
    systemInstruction: string,
    turns: ChatTurn[],
    options: { tools?: FunctionDeclaration[]; execute?: ToolExecutor; signal?: AbortSignal; apiKey?: string } = {},
  ): AsyncGenerator<GeminiEvent> {
    // Clave de la empresa si la configuró; si no, la de la plataforma.
    const ai = options.apiKey ? geminiClient(options.apiKey) : this.ai;
    const contents: Content[] = turns.map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }],
    }));
    const hasTools = Boolean(options.tools?.length && options.execute);

    for (let round = 0; ; round++) {
      // En la última ronda se quitan las herramientas para obligar a responder.
      const useTools = hasTools && round < MAX_TOOL_ROUNDS;
      const stream = await ai.models.generateContentStream({
        model: this.config.geminiModel,
        contents,
        config: {
          systemInstruction,
          abortSignal: options.signal,
          ...(useTools ? { tools: [{ functionDeclarations: options.tools }] } : {}),
        },
      });

      // Se guardan las partes tal cual (incluidas las firmas de pensamiento),
      // porque Gemini las exige de vuelta al continuar tras una llamada.
      const modelParts: Part[] = [];
      const calls: FunctionCall[] = [];
      for await (const chunk of stream) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          modelParts.push(part);
          if (part.functionCall) calls.push(part.functionCall);
          else if (part.text && !part.thought) yield { type: 'text', text: part.text };
        }
      }

      if (!useTools || calls.length === 0) return;

      contents.push({ role: 'model', parts: modelParts });
      const responses: Part[] = [];
      for (const call of calls) {
        const name = call.name ?? '';
        const args = (call.args ?? {}) as Record<string, unknown>;
        let result: Record<string, unknown>;
        try {
          result = await options.execute!(name, args);
        } catch (err) {
          result = { error: (err as Error).message };
        }
        yield { type: 'tool', name, args, result };
        responses.push({ functionResponse: { id: call.id, name, response: result } });
      }
      contents.push({ role: 'user', parts: responses });
    }
  }
}
