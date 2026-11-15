import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import type { LlmProvider, ModelSettings } from '../../domain/models/catalog';
import { MissingModelKeyError, type LlmRoute, type LlmTarget } from '../../domain/llm/llm';
import {
  MODEL_SETTINGS_REPOSITORY,
  PROVIDER_KEY_READER,
  type ModelSettingsRepository,
  type ProviderCredential,
  type ProviderKeyReader,
} from '../ports';

/** Cuánto se recuerda la configuración de un proyecto (se invalida al guardarla). */
const TTL_MS = 30_000;

export type { ProviderCredential };

/**
 * Modelos que usa cada proyecto (se eligen en «Asistente y widget → Modelos»):
 * proveedor y modelo de lenguaje, respaldo y modelo de embeddings. Arma la
 * ruta de modelos con las claves del asistente.
 */
@Injectable()
export class ModelSettingsService {
  private readonly cache = new Map<string, { at: number; settings: ModelSettings }>();

  constructor(
    @Inject(MODEL_SETTINGS_REPOSITORY) private readonly repository: ModelSettingsRepository,
    @Inject(PROVIDER_KEY_READER) private readonly keys: ProviderKeyReader,
    private readonly config: AppConfig,
  ) {}

  async get(projectId: string): Promise<ModelSettings> {
    const hit = this.cache.get(projectId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.settings;
    const settings = await this.repository.find(projectId);
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(projectId, { at: Date.now(), settings });
    return settings;
  }

  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }

  /** Modelo de embeddings efectivo del proyecto. */
  async embeddingModel(projectId: string): Promise<string> {
    return (await this.get(projectId)).embeddingModel || this.config.embeddingModel;
  }

  defaultModel(provider: LlmProvider): string {
    return this.config.defaultModels[provider];
  }

  /** Qué claves tiene el asistente para cada proveedor (sin revelarlas). */
  availability(projectId: string): Promise<Record<LlmProvider, ProviderCredential>> {
    return this.repository.credentials(projectId);
  }

  /** Modelo concreto con la clave del asistente. Null si el asistente no tiene clave de ese proveedor. */
  async target(projectId: string, provider: LlmProvider, model: string | null): Promise<LlmTarget | null> {
    const apiKey = await this.keys.getKey(projectId, provider);
    if (!apiKey) return null;
    return { provider, model: model || this.defaultModel(provider), apiKey, keyOwner: 'company' };
  }

  /**
   * Ruta de modelos del proyecto: principal y respaldo, con las claves del
   * asistente. Sin clave para el principal no se puede responder.
   */
  async route(projectId: string, settings: ModelSettings): Promise<LlmRoute> {
    const primary = await this.target(projectId, settings.llmProvider, settings.llmModel);
    if (!primary) throw new MissingModelKeyError(settings.llmProvider);
    let fallback: LlmTarget | null = null;
    if (settings.llmFallback !== 'none' && this.config.llmFallback) {
      fallback = await this.target(projectId, settings.llmFallback, settings.llmFallbackModel);
      if (fallback && fallback.provider === primary.provider && fallback.model === primary.model) fallback = null;
    }
    return { primary, fallback };
  }
}
