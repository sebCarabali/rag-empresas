import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import type { Reranker, RerankResult } from '../../application/ports';

/** Puntúa pares (pregunta, fragmento): devuelve un número por fragmento, mayor = más relevante. */
export type PairScorer = (query: string, passages: string[]) => Promise<number[]>;

/** Caracteres de cada fragmento que se pasan al reordenador (el modelo trunca igual a max_length). */
const PASSAGE_CHARS = 1500;
/** Pares por pasada del modelo: limita la memoria en CPU. */
const BATCH = 10;

let scorerPromise: Promise<PairScorer> | null = null;


/**
 * Ordena por puntuación descendente; en empate conserva el orden de la
 * búsqueda híbrida. Devuelve los elementos con la puntuación adjunta.
 */
export function orderByScores<T>(items: T[], scores: number[]): Array<T & { rerank_score: number }> {
  return items
    .map((item, i) => ({ item, i, s: Number.isFinite(scores[i]) ? scores[i] : -Infinity }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ item, s }) => ({ ...item, rerank_score: s }));
}

/**
 * Reordenador (cross-encoder) local con Transformers.js: lee la pregunta y cada
 * fragmento juntos, así que distingue mejor qué fragmento responde de verdad
 * que la búsqueda vectorial + texto. Se aplica a los candidatos de la búsqueda
 * antes de elegir los que van al modelo.
 *
 * Nunca bloquea una respuesta: si está desactivado, el modelo no carga o tarda
 * más de RERANKER_TIMEOUT_MS, se devuelve el orden original.
 */
@Injectable()
export class TransformersReranker implements Reranker {
  private readonly logger = new Logger(TransformersReranker.name);
  /** Solo para pruebas: reemplaza el modelo. */
  scorerOverride: PairScorer | null = null;

  constructor(private readonly config: AppConfig) {}

  get enabled(): boolean {
    return this.config.reranker.enabled;
  }

  async rerank<T extends { content: string }>(query: string, items: T[]): Promise<RerankResult<T & { rerank_score?: number }>> {
    const started = Date.now();
    if (!this.enabled || items.length < 2) return { items, reranked: false, ms: 0 };
    try {
      const scores = await this.withTimeout(this.score(query, items.map((c) => c.content.slice(0, PASSAGE_CHARS))));
      return { items: orderByScores(items, scores), reranked: true, ms: Date.now() - started };
    } catch (err) {
      this.logger.warn(`Reordenador omitido: ${(err as Error).message}`);
      return { items, reranked: false, ms: Date.now() - started };
    }
  }

  /** Carga el modelo por adelantado (p. ej. al arrancar el worker); los errores se ignoran. */
  preload(): void {
    if (this.enabled && !this.scorerOverride) void this.getScorer().catch(() => undefined);
  }

  private async score(query: string, passages: string[]): Promise<number[]> {
    const scorer = this.scorerOverride ?? (await this.getScorer());
    const out: number[] = [];
    for (let i = 0; i < passages.length; i += BATCH) {
      out.push(...(await scorer(query, passages.slice(i, i + BATCH))));
    }
    return out;
  }

  private withTimeout<R>(promise: Promise<R>): Promise<R> {
    const ms = this.config.reranker.timeoutMs;
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`tardó más de ${ms} ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  private getScorer(): Promise<PairScorer> {
    if (!scorerPromise) {
      scorerPromise = this.loadScorer().catch((err) => {
        scorerPromise = null; // reintento en la siguiente pregunta
        throw err;
      });
    }
    return scorerPromise;
  }

  private async loadScorer(): Promise<PairScorer> {
    const started = Date.now();
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@huggingface/transformers');
    if (process.env.VERCEL) env.cacheDir = '/tmp/transformers-cache';
    const { model: modelId, modelFile, dtype, maxLength } = this.config.reranker;

    const tokenizer = await AutoTokenizer.from_pretrained(modelId);
    const model = await AutoModelForSequenceClassification.from_pretrained(modelId, {
      dtype: dtype as 'fp32',
      ...(modelFile ? { model_file_name: modelFile } : {}),
    });
    this.logger.log(`Reordenador ${modelId} cargado en ${Date.now() - started} ms`);

    return async (query, passages) => {
      const inputs = tokenizer(new Array(passages.length).fill(query), {
        text_pair: passages,
        padding: true,
        truncation: true,
        max_length: maxLength,
      });
      const { logits } = (await model(inputs)) as { logits: { data: Float32Array | number[]; dims: number[] } };
      // Una salida por par (logit de relevancia). Si el modelo tuviera dos clases, se usa la positiva.
      const width = logits.dims[1] ?? 1;
      return passages.map((_, i) => Number(logits.data[i * width + (width - 1)]));
    };
  }
}
