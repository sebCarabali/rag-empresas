import { Injectable, Logger } from '@nestjs/common';
import { geminiClient } from '../chat/gemini.service';
import { ProjectKeysService } from '../models/project-keys.service';
import { AppConfig } from '../config/app-config';
import { embeddingModel, OPENAI_COMPATIBLE_BASE, type EmbeddingModel } from '../models/catalog';

type Extractor = (
  input: string | string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * Los modelos locales se cargan una sola vez por instancia (Fluid compute
 * reutiliza instancias entre invocaciones), uno por id.
 */
const extractors = new Map<string, Promise<Extractor>>();

/** Para qué se pide el embedding (algunos modelos lo usan para optimizarlo). */
export type EmbedKind = 'query' | 'passage';

/** Con qué modelo y para qué proyecto (los modelos por API usan la clave del asistente). */
export interface EmbedOptions {
  model?: string | null;
  projectId?: string | null;
}

/**
 * Embeddings locales (Transformers.js + ONNX, familia E5 con prefijos
 * "query:"/"passage:"; no necesitan clave) o por API (Gemini, OpenAI, con la
 * clave del asistente), según el modelo elegido en la configuración.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly keys: ProjectKeysService,
  ) {}

  /** Modelo efectivo: el elegido o el de la plataforma. */
  modelId(model?: string | null): string {
    return model || this.config.embeddingModel;
  }

  async embedPassages(texts: string[], options: EmbedOptions = {}): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embed(texts, 'passage', options);
  }

  async embedQuery(text: string, options: EmbedOptions = {}): Promise<number[]> {
    return (await this.embed([text], 'query', options))[0];
  }

  private async embed(texts: string[], kind: EmbedKind, options: EmbedOptions): Promise<number[][]> {
    const id = this.modelId(options.model);
    const spec = embeddingModel(id) ?? localSpec(id);
    let vectors: number[][];
    if (spec.provider === 'gemini') vectors = await this.gemini(spec, texts, kind, await this.apiKey(options, 'gemini'));
    else if (spec.provider === 'openai') vectors = await this.openai(spec, texts, await this.apiKey(options, 'openai'));
    else vectors = await this.local(id, texts, kind);
    return check(vectors, spec);
  }

  private async local(id: string, texts: string[], kind: EmbedKind): Promise<number[][]> {
    const extractor = await this.getExtractor(id);
    const output = await extractor(
      texts.map((t) => `${kind}: ${t}`),
      { pooling: 'mean', normalize: true },
    );
    return output.tolist();
  }

  /** Clave del asistente para los embeddings por API. */
  private apiKey(options: EmbedOptions, provider: 'gemini' | 'openai'): Promise<string> {
    if (!options.projectId) throw new Error('Falta el proyecto para usar un modelo de embeddings por API');
    return this.keys.requireKey(options.projectId, provider, 'calcular los embeddings');
  }

  private async gemini(spec: EmbeddingModel, texts: string[], kind: EmbedKind, apiKey: string): Promise<number[][]> {
    const response = await geminiClient(apiKey).models.embedContent({
      model: spec.id,
      contents: texts,
      config: {
        taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        outputDimensionality: spec.dimensions,
      },
    });
    // Con menos dimensiones que las nativas, Gemini no normaliza: se hace aquí.
    return (response.embeddings ?? []).map((e) => normalize(e.values ?? []));
  }

  private async openai(spec: EmbeddingModel, texts: string[], apiKey: string): Promise<number[][]> {
    const res = await fetch(`${OPENAI_COMPATIBLE_BASE.openai}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: spec.id, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`), { status: res.status });
    }
    const body = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  private getExtractor(id: string): Promise<Extractor> {
    let promise = extractors.get(id);
    if (!promise) {
      promise = this.loadExtractor(id).catch((err) => {
        extractors.delete(id); // permitir reintento en la siguiente llamada
        throw err;
      });
      extractors.set(id, promise);
    }
    return promise;
  }

  private async loadExtractor(id: string): Promise<Extractor> {
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

/** Modelo local fuera del catálogo (configurado por variable de entorno): dimensión sin verificar. */
function localSpec(id: string): EmbeddingModel {
  return { id, label: id, provider: 'local', dimensions: 0, note: '', pricePerM: 0 };
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? v.map((x) => x / norm) : v;
}

function check(vectors: number[][], spec: EmbeddingModel): number[][] {
  for (const v of vectors) {
    if (spec.dimensions && v.length !== spec.dimensions) {
      throw new Error(`El modelo ${spec.id} devolvió vectores de ${v.length} dimensiones; se esperaban ${spec.dimensions}`);
    }
  }
  return vectors;
}

/** Formato de texto que entiende pgvector: "[0.1,0.2,...]". */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
