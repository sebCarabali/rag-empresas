import type { Source } from '../../domain/chat/prompt';
import type { ModelInfo } from '../../domain/llm/llm';
import type { CatalogToolCall } from './knowledge-base.port';

export interface CachedAnswer {
  answer: string;
  sources: Source[];
  toolCalls: CatalogToolCall[];
  modelInfo?: ModelInfo | null;
}

/** Datos para la búsqueda por significado de una entrada. */
export interface SemanticFields {
  embedding: number[] | null;
  version: string;
  variant: string;
  /** Modelo de lenguaje principal (ver cacheModelKey). */
  model: string;
  /** Modelo con que se calculó el embedding de la pregunta. */
  embeddingModel: string;
}

export interface SimilarQuestion {
  cache_key: string;
  question: string;
  similarity: number;
  variant: string | null;
}

/** Puerto de salida: respuestas guardadas. */
export interface AnswerCache {
  readonly enabled: boolean;
  readonly semanticEnabled: boolean;
  key(projectId: string, version: string, question: string, variant: string, model: string): string;
  get(key: string): Promise<CachedAnswer | null>;
  similar(
    projectId: string,
    semantic: Pick<SemanticFields, 'version' | 'model' | 'embeddingModel'>,
    variant: string | null,
    embedding: number[],
    minSimilarity?: number,
  ): Promise<SimilarQuestion[]>;
  put(key: string, projectId: string, question: string, value: CachedAnswer, semantic?: SemanticFields): Promise<void>;
  /** Respuestas vigentes del proyecto. */
  count(projectId: string): Promise<number>;
  /** Quita los embeddings de las preguntas (tras cambiar de modelo); las respuestas exactas siguen sirviendo. */
  forgetEmbeddings(projectId: string): Promise<void>;
}

export const ANSWER_CACHE = Symbol('ANSWER_CACHE');
