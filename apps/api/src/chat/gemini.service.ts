import { Injectable } from '@nestjs/common';
import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type Part,
} from '@google/genai';
import { AppConfig } from '../config/app-config';
import { geminiUsage } from '../usage/usage.service';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export type GeminiEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; args: Record<string, unknown>; result: Record<string, unknown> }
  /** Tokens de una llamada al modelo (una por ronda). */
  | { type: 'usage'; input: number; output: number };

/** Rondas máximas de llamadas a herramientas antes de forzar la respuesta final. */
const MAX_TOOL_ROUNDS = 4;

/** Indicación que se agrega cuando el modelo debe responder ya, sin más consultas. */
const ANSWER_NOW =
  'Con la información anterior, responde ahora la pregunta del usuario en texto, sin hacer más consultas.';

/** Gemini terminó sin escribir texto (solo consultas o una respuesta vacía). */
export class GeminiEmptyAnswerError extends Error {
  constructor() {
    super('Gemini no generó texto en la respuesta');
  }
}

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

    let wroteText = false;
    let emptyRetried = false;
    for (let round = 0; ; round++) {
      // En la última ronda las herramientas siguen declaradas (el historial tiene
      // llamadas a funciones) pero se prohíbe usarlas, para obligar a responder.
      const finalRound = hasTools && round >= MAX_TOOL_ROUNDS;
      const stream = await ai.models.generateContentStream({
        model: this.config.geminiModel,
        contents,
        config: {
          systemInstruction,
          abortSignal: options.signal,
          ...(hasTools ? { tools: [{ functionDeclarations: options.tools }] } : {}),
          ...(finalRound ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } } : {}),
        },
      });

      // Se guardan las partes tal cual (incluidas las firmas de pensamiento),
      // porque Gemini las exige de vuelta al continuar tras una llamada.
      const modelParts: Part[] = [];
      const calls: FunctionCall[] = [];
      let usage: ReturnType<typeof geminiUsage> = null;
      for await (const chunk of stream) {
        usage = geminiUsage(chunk.usageMetadata) ?? usage; // el último trae el total de la llamada
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          modelParts.push(part);
          if (part.functionCall) calls.push(part.functionCall);
          else if (part.text && !part.thought) {
            wroteText = true;
            yield { type: 'text', text: part.text };
          }
        }
      }

      if (usage) yield { type: 'usage', ...usage };

      if (finalRound || !hasTools || calls.length === 0) {
        if (wroteText) return;
        // Respuesta vacía: se insiste una vez pidiendo el texto; si sigue vacía es un
        // fallo y responden el respaldo o la caché.
        if (emptyRetried) throw new GeminiEmptyAnswerError();
        emptyRetried = true;
        if (modelParts.length && calls.length === 0) contents.push({ role: 'model', parts: modelParts });
        contents.push({ role: 'user', parts: [{ text: ANSWER_NOW }] });
        round = Math.max(round, MAX_TOOL_ROUNDS - 1); // la siguiente es la ronda final
        continue;
      }

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
      // Antes de la ronda final se pide explícitamente la respuesta.
      if (round + 1 >= MAX_TOOL_ROUNDS) responses.push({ text: ANSWER_NOW });
      contents.push({ role: 'user', parts: responses });
    }
  }
}
