import { Injectable, Logger } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { AppConfig } from '../config/app-config';
import { GeminiService, type ChatTurn, type GeminiEvent, type ToolExecutor } from './gemini.service';
import { GroqService } from './groq.service';

/** Modelo que respondió (se muestra en el chat y se guarda con el mensaje). */
export interface ModelInfo {
  provider: 'gemini' | 'groq';
  model: string;
  /** true si se usó el modelo de respaldo porque el principal falló. */
  fallback: boolean;
  /** Motivo del cambio, en lenguaje claro. */
  reason?: string;
}

export type LlmEvent =
  | GeminiEvent
  | { type: 'model'; info: ModelInfo }
  /** Descarta lo que el modelo anterior alcanzó a escribir antes de fallar. */
  | { type: 'reset' };

class FirstEventTimeout extends Error {}

/** Traduce el error del proveedor a un motivo comprensible para el usuario. */
export function describeFailure(err: unknown): string {
  if (err instanceof FirstEventTimeout) return 'Gemini no respondió a tiempo';
  const raw = `${(err as { status?: number })?.status ?? ''} ${(err as Error)?.message ?? String(err)}`;
  if (/429|quota|exhausted|rate limit|resource_exhausted/i.test(raw)) return 'Gemini agotó su cuota';
  if (/401|403|api key|permission|unauthenticated/i.test(raw)) return 'la clave de Gemini no es válida o no tiene permisos';
  if (/500|502|503|504|unavailable|overloaded|internal/i.test(raw)) return 'Gemini no está disponible en este momento';
  if (/fetch failed|network|econn|etimedout|socket/i.test(raw)) return 'no se pudo conectar con Gemini';
  return 'Gemini devolvió un error';
}

/**
 * Orquesta el modelo principal (Gemini) y el de respaldo (Groq). Si Gemini
 * falla o no empieza a responder a tiempo, la misma pregunta —con el mismo
 * contexto y las mismas herramientas— se reintenta en Groq.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly groq: GroqService,
    private readonly config: AppConfig,
  ) {}

  async *run(
    systemInstruction: string,
    turns: ChatTurn[],
    options: { tools?: FunctionDeclaration[]; execute?: ToolExecutor; signal?: AbortSignal } = {},
  ): AsyncGenerator<LlmEvent> {
    yield { type: 'model', info: { provider: 'gemini', model: this.config.geminiModel, fallback: false } };

    // Señal propia para poder cortar a Gemini si tarda demasiado en empezar.
    const geminiAbort = new AbortController();
    const onOuterAbort = () => geminiAbort.abort();
    options.signal?.addEventListener('abort', onOuterAbort);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      geminiAbort.abort();
    }, this.config.geminiFirstEventTimeoutMs);

    let emitted = false;
    try {
      for await (const event of this.gemini.run(systemInstruction, turns, { ...options, signal: geminiAbort.signal })) {
        clearTimeout(timer);
        emitted = true;
        yield event;
      }
      return;
    } catch (err) {
      if (options.signal?.aborted) throw err; // el usuario canceló: no hay respaldo
      const failure = timedOut ? new FirstEventTimeout() : err;
      if (!this.config.llmFallback || !this.groq.enabled) throw failure;

      const reason = describeFailure(failure);
      this.logger.warn(`${reason} (${(err as Error)?.message ?? err}); se responde con Groq ${this.groq.model}`);
      if (emitted) yield { type: 'reset' };
      yield { type: 'model', info: { provider: 'groq', model: this.groq.model, fallback: true, reason } };
      yield* this.groq.run(systemInstruction, turns, options);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}
