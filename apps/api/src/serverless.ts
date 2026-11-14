import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './bootstrap';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let handlerPromise: Promise<Handler> | null = null;

/**
 * Devuelve la instancia de Express de Nest, inicializada una sola vez por
 * instancia de la función (Fluid compute la reutiliza entre peticiones).
 */
export function getHttpHandler(): Promise<Handler> {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      const app = await createApp();
      await app.init();
      return app.getHttpAdapter().getInstance() as Handler;
    })().catch((err) => {
      handlerPromise = null;
      throw err;
    });
  }
  return handlerPromise;
}
