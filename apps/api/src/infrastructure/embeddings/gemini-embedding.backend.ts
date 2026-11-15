import { Injectable } from '@nestjs/common';
import type { EmbeddingModel } from '../../domain/models/catalog';
import type { EmbedKind, EmbeddingBackend } from '../../application/ports';
import { geminiClient } from '../llm/gemini-chat-model';
import { normalize } from './normalize';

/** Embeddings de Gemini (tipo de tarea según sea pregunta o documento). */
@Injectable()
export class GeminiEmbeddingBackend implements EmbeddingBackend {
  readonly provider = 'gemini' as const;
  readonly needsKey = true;

  async embed(texts: string[], kind: EmbedKind, model: EmbeddingModel, apiKey: string | null): Promise<number[][]> {
    const response = await geminiClient(apiKey!).models.embedContent({
      model: model.id,
      contents: texts,
      config: {
        taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        outputDimensionality: model.dimensions,
      },
    });
    // Con menos dimensiones que las nativas, Gemini no normaliza: se hace aquí.
    return (response.embeddings ?? []).map((e) => normalize(e.values ?? []));
  }
}
