import type { EmbeddingModel } from '../../domain/models/catalog';
import type { EmbeddingBackend } from '../../application/ports';
import type { OpenAiDialect } from '../llm/openai-dialects';
import { normalize } from './normalize';

/** Embeddings por /v1/embeddings de APIs compatibles con OpenAI (OpenAI, Mistral). */
export class OpenAiCompatibleEmbeddingBackend implements EmbeddingBackend {
  readonly provider: 'openai' | 'mistral';
  readonly needsKey = true;

  constructor(private readonly dialect: OpenAiDialect & { provider: 'openai' | 'mistral' }) {
    this.provider = dialect.provider;
  }

  async embed(texts: string[], _kind: unknown, model: EmbeddingModel, apiKey: string | null): Promise<number[][]> {
    const res = await fetch(`${this.dialect.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.id, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`${this.dialect.label} ${res.status}: ${detail.slice(0, 300)}`), { status: res.status });
    }
    const body = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    return body.data.sort((a, b) => a.index - b.index).map((d) => normalize(d.embedding));
  }
}
