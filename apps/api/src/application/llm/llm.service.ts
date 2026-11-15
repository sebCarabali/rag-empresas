import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { PROVIDER_LABEL } from '../../domain/models/catalog';
import {
  describeFailure,
  type ChatTurn,
  type LlmEvent,
  type LlmRoute,
  type LlmTarget,
  type ToolDeclaration,
  type ToolExecutor,
} from '../../domain/llm/llm';
import type { ChatModel } from '../ports';
import { ChatModelRegistry } from './chat-model-registry';
import { FirstEventTimeoutChatModel } from './timeout-chat-model';

export interface RunOptions {
  tools?: ToolDeclaration[];
  execute?: ToolExecutor;
  signal?: AbortSignal;
  /** Modelos elegidos en la configuración del asistente, con sus claves. */
  route: LlmRoute;
  /** false: si el principal falla, se lanza el error en vez de usar el respaldo. */
  allowFallback?: boolean;
}

/**
 * Orquesta el modelo principal y el de respaldo elegidos en la configuración
 * del asistente, con las claves que la empresa guardó en él. Si el principal
 * falla o no empieza a responder a tiempo (decorador de tiempo límite), la
 * misma pregunta —con el mismo contexto y las mismas herramientas— se
 * reintenta con el respaldo. Depende solo del puerto ChatModel.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly registry: ChatModelRegistry,
    private readonly config: AppConfig,
  ) {}

  /** Adaptador del principal, envuelto con el tiempo límite para el primer evento. */
  private primaryModel(target: LlmTarget): ChatModel {
    return new FirstEventTimeoutChatModel(this.registry.get(target.provider), this.config.geminiFirstEventTimeoutMs);
  }

  async *run(systemInstruction: string, turns: ChatTurn[], options: RunOptions): AsyncGenerator<LlmEvent> {
    const { primary, fallback } = options.route;
    const request = { systemInstruction, turns, tools: options.tools, execute: options.execute };
    yield { type: 'model', info: { provider: primary.provider, model: primary.model, fallback: false, keyOwner: primary.keyOwner } };

    let emitted = false;
    try {
      for await (const event of this.primaryModel(primary).stream({ ...request, model: primary.model, apiKey: primary.apiKey, signal: options.signal })) {
        emitted = true;
        yield event;
      }
      return;
    } catch (err) {
      if (options.signal?.aborted) throw err; // el usuario canceló: no hay respaldo
      if (options.allowFallback === false || !fallback) throw err;

      const reason = describeFailure(err, primary.provider);
      this.logger.warn(`${reason} (${(err as Error)?.message ?? err}); se responde con ${PROVIDER_LABEL[fallback.provider]} ${fallback.model}`);
      if (emitted) yield { type: 'reset' };
      yield {
        type: 'model',
        info: { provider: fallback.provider, model: fallback.model, fallback: true, reason, keyOwner: fallback.keyOwner },
      };
      yield* this.registry.get(fallback.provider).stream({ ...request, model: fallback.model, apiKey: fallback.apiKey, signal: options.signal });
    }
  }
}
