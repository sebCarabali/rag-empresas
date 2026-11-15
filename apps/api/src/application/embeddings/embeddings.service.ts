import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { embeddingModel, type EmbeddingModel, type LlmProvider } from '../../domain/models/catalog';
import {
  EMBEDDING_BACKENDS,
  PROVIDER_KEY_READER,
  type EmbedKind,
  type EmbeddingBackend,
  type ProviderKeyReader,
} from '../ports';

/** Con qué modelo y para qué proyecto (los modelos por API usan la clave del asistente). */
export interface EmbedOptions {
  model?: string | null;
  projectId?: string | null;
}

/**
 * Calcula embeddings con el modelo elegido en la configuración del asistente.
 * Elige el backend (Strategy) según el proveedor del modelo y le pasa la clave
 * del asistente si la necesita. No conoce ninguna API concreta.
 */
@Injectable()
export class EmbeddingsService {
  private readonly backends: Map<string, EmbeddingBackend>;

  constructor(
    private readonly config: AppConfig,
    @Inject(PROVIDER_KEY_READER) private readonly keys: ProviderKeyReader,
    @Inject(EMBEDDING_BACKENDS) backends: EmbeddingBackend[],
  ) {
    this.backends = new Map(backends.map((b) => [b.provider, b]));
  }

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
    const spec = embeddingModel(this.modelId(options.model)) ?? localSpec(this.modelId(options.model));
    const backend = this.backends.get(spec.provider);
    if (!backend) throw new Error(`No hay backend de embeddings para ${spec.provider}`);
    let apiKey: string | null = null;
    if (backend.needsKey) {
      if (!options.projectId) throw new Error('Falta el proyecto para usar un modelo de embeddings por API');
      apiKey = await this.keys.requireKey(options.projectId, spec.provider as LlmProvider, 'calcular los embeddings');
    }
    return check(await backend.embed(texts, kind, spec, apiKey), spec);
  }
}

/** Modelo local fuera del catálogo (configurado por variable de entorno): dimensión sin verificar. */
function localSpec(id: string): EmbeddingModel {
  return { id, label: id, provider: 'local', dimensions: 0, note: '', pricePerM: 0 };
}

function check(vectors: number[][], spec: EmbeddingModel): number[][] {
  for (const v of vectors) {
    if (spec.dimensions && v.length !== spec.dimensions) {
      throw new Error(`El modelo ${spec.id} devolvió vectores de ${v.length} dimensiones; se esperaban ${spec.dimensions}`);
    }
  }
  return vectors;
}
