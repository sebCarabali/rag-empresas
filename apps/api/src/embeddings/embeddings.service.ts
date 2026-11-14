import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';

type Extractor = (
  input: string | string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * El modelo se carga una sola vez por instancia (Fluid compute reutiliza
 * instancias entre invocaciones). Se guarda a nivel de módulo para que lo
 * compartan la app HTTP y el contexto del worker si viven en la misma instancia.
 */
let extractorPromise: Promise<Extractor> | null = null;

/**
 * Embeddings locales y gratuitos (por defecto multilingual-e5-small; Transformers.js + ONNX).
 * Los modelos E5 requieren prefijos: "passage: " para documentos y "query: " para preguntas.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  constructor(private readonly config: AppConfig) {}

  private getExtractor(): Promise<Extractor> {
    if (!extractorPromise) {
      extractorPromise = this.loadExtractor().catch((err) => {
        extractorPromise = null; // permitir reintento en la siguiente llamada
        throw err;
      });
    }
    return extractorPromise;
  }

  private async loadExtractor(): Promise<Extractor> {
    const started = Date.now();
    const { pipeline, env } = await import('@huggingface/transformers');
    // En Vercel solo /tmp es escribible: ahí se cachea el modelo descargado.
    if (process.env.VERCEL) env.cacheDir = '/tmp/transformers-cache';

    const extractor = await pipeline('feature-extraction', this.config.embeddingModel, {
      dtype: this.config.embeddingDtype as 'q8', // q8: cuantizado, más liviano y rápido en CPU
    });
    this.logger.log(`Modelo ${this.config.embeddingModel} cargado en ${Date.now() - started} ms`);
    return extractor as unknown as Extractor;
  }

  async embedPassages(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(
      texts.map((t) => `passage: ${t}`),
      { pooling: 'mean', normalize: true },
    );
    return this.check(output.tolist());
  }

  async embedQuery(text: string): Promise<number[]> {
    const extractor = await this.getExtractor();
    const output = await extractor(`query: ${text}`, { pooling: 'mean', normalize: true });
    return this.check(output.tolist())[0];
  }

  private check(vectors: number[][]): number[][] {
    const expected = this.config.embeddingDimensions;
    for (const v of vectors) {
      if (v.length !== expected) {
        throw new Error(
          `El modelo devolvió vectores de ${v.length} dimensiones; la base espera ${expected}`,
        );
      }
    }
    return vectors;
  }
}

/** Formato de texto que entiende pgvector: "[0.1,0.2,...]". */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
