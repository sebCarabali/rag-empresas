import { Injectable, Logger } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { AppConfig } from '../../infrastructure/config/app-config';
import { PROVIDER_LABEL, type LlmProvider } from '../../domain/models/catalog';
import { GeminiEmptyAnswerError, GeminiService, type ChatTurn, type GeminiEvent, type ToolExecutor } from '../../infrastructure/llm/gemini-chat-model';
import { GroqService } from '../../infrastructure/llm/openai-compatible-chat-model';

/** Modelo que respondió (se muestra en el chat y se guarda con el mensaje). */
export interface ModelInfo {
  provider: LlmProvider;
  model: string;
  /** true si se usó el modelo de respaldo porque el principal falló. */
  fallback: boolean;
  /** Motivo del cambio, en lenguaje claro. */
  reason?: string;
  /** Siempre 'company': la clave la pone la empresa en el asistente ('platform' solo en registros antiguos). */
  keyOwner?: 'company' | 'platform';
}

/** Un modelo concreto con la clave con que se llama. */
export interface LlmTarget {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  keyOwner: 'company';
}

/** Modelo principal y, opcionalmente, el de respaldo. */
export interface LlmRoute {
  primary: LlmTarget;
  fallback: LlmTarget | null;
}

export type LlmEvent =
  | GeminiEvent
  | { type: 'model'; info: ModelInfo }
  /** Descarta lo que el modelo anterior alcanzó a escribir antes de fallar. */
  | { type: 'reset' };

class FirstEventTimeout extends Error {}

/** Traduce el error del proveedor a un motivo comprensible para el usuario. */
export function describeFailure(err: unknown, provider: LlmProvider = 'gemini'): string {
  const name = PROVIDER_LABEL[provider];
  if (err instanceof FirstEventTimeout) return `${name} no respondió a tiempo`;
  if (err instanceof GeminiEmptyAnswerError) return `${name} no generó una respuesta`;
  const raw = `${(err as { status?: number })?.status ?? ''} ${(err as Error)?.message ?? String(err)}`;
  if (/429|quota|exhausted|rate limit|resource_exhausted/i.test(raw)) return `${name} agotó su cuota`;
  if (/401|403|api key|permission|unauthenticated|invalid_api_key/i.test(raw)) return `la clave de ${name} no es válida o no tiene permisos`;
  if (/404|not found|model_not_found|does not exist/i.test(raw)) return `${name} no reconoce el modelo configurado`;
  if (/500|502|503|504|unavailable|overloaded|internal/i.test(raw)) return `${name} no está disponible en este momento`;
  if (/fetch failed|network|econn|etimedout|socket/i.test(raw)) return `no se pudo conectar con ${name}`;
  return `${name} devolvió un error`;
}

/**
 * Orquesta el modelo principal y el de respaldo elegidos en la configuración
 * del asistente, con las claves que la empresa guardó en él. Si el principal
 * falla o no empieza a responder a tiempo, la misma pregunta —con el mismo
 * contexto y las mismas herramientas— se reintenta con el respaldo.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly groq: GroqService,
    private readonly config: AppConfig,
  ) {}

  /** Ejecuta un modelo concreto. */
  private call(
    target: LlmTarget,
    systemInstruction: string,
    turns: ChatTurn[],
    options: { tools?: FunctionDeclaration[]; execute?: ToolExecutor; signal?: AbortSignal },
  ): AsyncGenerator<GeminiEvent> {
    if (target.provider === 'gemini') {
      return this.gemini.run(systemInstruction, turns, { ...options, apiKey: target.apiKey, model: target.model });
    }
    return this.groq.run(systemInstruction, turns, {
      ...options,
      target: { provider: target.provider, model: target.model, apiKey: target.apiKey },
    });
  }

  async *run(
    systemInstruction: string,
    turns: ChatTurn[],
    options: {
      tools?: FunctionDeclaration[];
      execute?: ToolExecutor;
      signal?: AbortSignal;
      /** Modelos elegidos en la configuración del asistente, con sus claves. */
      route: LlmRoute;
      /** false: si el principal falla, se lanza el error en vez de usar el respaldo. */
      allowFallback?: boolean;
    },
  ): AsyncGenerator<LlmEvent> {
    const { primary, fallback } = options.route;
    yield { type: 'model', info: { provider: primary.provider, model: primary.model, fallback: false, keyOwner: primary.keyOwner } };

    // Señal propia para poder cortar al principal si tarda demasiado en empezar.
    const primaryAbort = new AbortController();
    const onOuterAbort = () => primaryAbort.abort();
    options.signal?.addEventListener('abort', onOuterAbort);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      primaryAbort.abort();
    }, this.config.geminiFirstEventTimeoutMs);

    let emitted = false;
    const callOptions = { tools: options.tools, execute: options.execute };
    try {
      for await (const event of this.call(primary, systemInstruction, turns, { ...callOptions, signal: primaryAbort.signal })) {
        clearTimeout(timer);
        emitted = true;
        yield event;
      }
      return;
    } catch (err) {
      if (options.signal?.aborted) throw err; // el usuario canceló: no hay respaldo
      const failure = timedOut ? new FirstEventTimeout() : err;
      if (options.allowFallback === false || !fallback) throw failure;

      const reason = describeFailure(failure, primary.provider);
      this.logger.warn(`${reason} (${(err as Error)?.message ?? err}); se responde con ${PROVIDER_LABEL[fallback.provider]} ${fallback.model}`);
      if (emitted) yield { type: 'reset' };
      yield {
        type: 'model',
        info: { provider: fallback.provider, model: fallback.model, fallback: true, reason, keyOwner: fallback.keyOwner },
      };
      yield* this.call(fallback, systemInstruction, turns, { ...callOptions, signal: options.signal });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}
