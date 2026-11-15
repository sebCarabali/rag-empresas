import { Injectable, Logger } from '@nestjs/common';
import type { EmbeddingModel } from '../../domain/models/catalog';
import type { EmbedKind, EmbeddingBackend } from '../../application/ports';
import { AppConfig } from '../../config/app-config';

type Extractor = (
  input: string | string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * Los modelos locales se cargan una sola vez por instancia (Fluid compute
 * reutiliza instancias entre invocaciones), uno por id.
 */
const extractors = new Map<string, Promise<Extractor>>();

/**
 * Embeddings locales con Transformers.js + ONNX (familia E5, con prefijos
 * "query:"/"passage:"). No necesitan clave ni tienen costo por uso.
 */
@Injectable()
export class LocalE5EmbeddingBackend implements EmbeddingBackend {
  readonly provider = 'local' as const;
  readonly needsKey = false;
  private readonly logger = new Logger(LocalE5EmbeddingBackend.name);

  constructor(private readonly config: AppConfig) {}

  async embed(texts: string[], kind: EmbedKind, model: EmbeddingModel): Promise<number[][]> {
    const extractor = await this.getExtractor(model.id);
    const output = await extractor(
      texts.map((t) => `${kind}: ${t}`),
      { pooling: 'mean', normalize: true },
    );
    return output.tolist();
  }

  private getExtractor(id: string): Promise<Extractor> {
    let promise = extractors.get(id);
    if (!promise) {
      promise = this.load(id).catch((err) => {
        extractors.delete(id); // permitir reintento en la siguiente llamada
        throw err;
      });
      extractors.set(id, promise);
    }
    return promise;
  }

  private async load(id: string): Promise<Extractor> {
    const started = Date.now();
    const { pipeline, env } = await import('@huggingface/transformers');
    // En Vercel solo /tmp es escribible: ahí se cachea el modelo descargado.
    if (process.env.VERCEL) env.cacheDir = '/tmp/transformers-cache';
    const extractor = await pipeline('feature-extraction', id, {
      dtype: this.config.embeddingDtype as 'q8', // q8: cuantizado, más liviano y rápido en CPU
    });
    this.logger.log(`Modelo ${id} cargado en ${Date.now() - started} ms`);
    return extractor as unknown as Extractor;
  }
}
