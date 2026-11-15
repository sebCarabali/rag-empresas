import type { EmbeddingModel, EmbeddingProvider } from '../../domain/models/catalog';

/** Para qué se pide el embedding (algunos modelos lo usan para optimizarlo). */
export type EmbedKind = 'query' | 'passage';

/**
 * Puerto de salida (Strategy): calcula embeddings con un tipo de proveedor
 * (modelo local, Gemini, OpenAI, Mistral…).
 */
export interface EmbeddingBackend {
  readonly provider: EmbeddingProvider;
  /** true si necesita la clave de API del asistente. */
  readonly needsKey: boolean;
  embed(texts: string[], kind: EmbedKind, model: EmbeddingModel, apiKey: string | null): Promise<number[][]>;
}

export const EMBEDDING_BACKENDS = Symbol('EMBEDDING_BACKENDS');
