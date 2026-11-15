import { Injectable, Logger } from '@nestjs/common';
import type { LlmRoute, LlmTarget } from '../chat/llm.service';
import { MissingModelKeyError, ProjectKeysService } from './project-keys.service';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from '../supabase/supabase.service';
import { DEFAULT_MODEL_SETTINGS, LLM_PROVIDERS, type LlmProvider, type ModelSettings } from './catalog';

/** Cuánto se recuerda la configuración de un proyecto (se invalida al guardarla). */
const TTL_MS = 30_000;

export interface ProviderAvailability {
  /** El asistente tiene guardada una clave de este proveedor. */
  configured: boolean;
  last4: string | null;
  updatedAt: string | null;
}

/** Fila de chatbots → configuración de modelos. */
export function toSettings(row: Record<string, unknown> | null | undefined): ModelSettings {
  if (!row) return { ...DEFAULT_MODEL_SETTINGS };
  return {
    llmProvider: (row.llm_provider as LlmProvider) ?? 'gemini',
    llmModel: (row.llm_model as string | null) ?? null,
    llmFallback: (row.llm_fallback as ModelSettings['llmFallback']) ?? 'none',
    llmFallbackModel: (row.llm_fallback_model as string | null) ?? null,
    embeddingModel: (row.embedding_model as string | null) ?? null,
  };
}

/**
 * Modelos que usa cada proyecto (se eligen en «Asistente y widget → Modelos»):
 * proveedor y modelo de lenguaje, respaldo y modelo de embeddings.
 */
@Injectable()
export class ModelSettingsService {
  private readonly logger = new Logger(ModelSettingsService.name);
  private readonly cache = new Map<string, { at: number; settings: ModelSettings }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly keys: ProjectKeysService,
    private readonly config: AppConfig,
  ) {}

  async get(projectId: string): Promise<ModelSettings> {
    const hit = this.cache.get(projectId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.settings;
    const { data, error } = await this.supabase.admin
      .from('chatbots')
      .select('llm_provider, llm_model, llm_fallback, llm_fallback_model, embedding_model')
      .eq('project_id', projectId)
      .maybeSingle();
    if (error) {
      this.logger.warn(`No se pudo leer la configuración de modelos de ${projectId}: ${error.message}`);
      return { ...DEFAULT_MODEL_SETTINGS };
    }
    const settings = toSettings(data);
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
    if (provider === 'gemini') return this.config.geminiModel;
    if (provider === 'groq') return this.config.groqModel;
    return this.config.openaiModel;
  }

  /** Qué claves tiene el asistente para cada proveedor (sin revelarlas). */
  async availability(projectId: string): Promise<Record<LlmProvider, ProviderAvailability>> {
    const { data } = await this.supabase.admin
      .from('chatbot_secrets')
      .select('gemini_key_last4, gemini_key_updated_at, openai_key_last4, openai_key_updated_at, groq_key_last4, groq_key_updated_at')
      .eq('project_id', projectId)
      .maybeSingle();
    const row = (data ?? {}) as Record<string, string | null>;
    const out = {} as Record<LlmProvider, ProviderAvailability>;
    for (const p of LLM_PROVIDERS) {
      const last4 = row[`${p}_key_last4`] ?? null;
      out[p] = { configured: Boolean(last4), last4, updatedAt: row[`${p}_key_updated_at`] ?? null };
    }
    return out;
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

/**
 * Identificador del modelo para la caché de respuestas. Con Gemini es solo el
 * modelo (así siguen sirviendo las respuestas guardadas antes de poder elegir
 * proveedor); con otros, "proveedor:modelo".
 */
export function cacheModelKey(target: Pick<LlmTarget, 'provider' | 'model'>): string {
  return target.provider === 'gemini' ? target.model : `${target.provider}:${target.model}`;
}
