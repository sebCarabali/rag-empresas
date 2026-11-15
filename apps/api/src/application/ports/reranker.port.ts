export interface RerankResult<T> {
  items: T[];
  /** false si no se reordenó (desactivado, sin modelo, error o tiempo agotado). */
  reranked: boolean;
  ms: number;
}

/** Puerto de salida: reordena candidatos por relevancia para una pregunta. */
export interface Reranker {
  rerank<T extends { content: string }>(query: string, items: T[]): Promise<RerankResult<T & { rerank_score?: number }>>;
}

export const RERANKER = Symbol('RERANKER');
