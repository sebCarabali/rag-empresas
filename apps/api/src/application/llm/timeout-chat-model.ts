import { FirstEventTimeoutError, type ModelEvent } from '../../domain/llm/llm';
import type { ChatModel, ChatRequest } from '../ports';

/**
 * Decorator: si el modelo no emite nada en `ms`, se corta la llamada y se
 * lanza FirstEventTimeoutError (para pasar al respaldo cuanto antes). Una vez
 * que empieza a responder, ya no hay límite.
 */
export class FirstEventTimeoutChatModel implements ChatModel {
  readonly provider: ChatModel['provider'];

  constructor(
    private readonly inner: ChatModel,
    private readonly ms: number,
  ) {
    this.provider = inner.provider;
  }

  async *stream(request: ChatRequest): AsyncGenerator<ModelEvent> {
    const abort = new AbortController();
    const onOuterAbort = () => abort.abort();
    request.signal?.addEventListener('abort', onOuterAbort);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, this.ms);
    try {
      for await (const event of this.inner.stream({ ...request, signal: abort.signal })) {
        clearTimeout(timer);
        yield event;
      }
    } catch (err) {
      if (timedOut && !request.signal?.aborted) throw new FirstEventTimeoutError(this.provider);
      throw err;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}
