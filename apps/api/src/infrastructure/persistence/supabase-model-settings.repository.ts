import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_MODEL_SETTINGS, LLM_PROVIDERS, type LlmProvider, type ModelSettings } from '../../domain/models/catalog';
import { DEFAULT_CHATBOT } from '../../domain/chatbots/chatbot';
import { ForbiddenError } from '../../domain/errors';
import type { DataScope, ModelSettingsRepository, ProjectRef, ProviderCredential } from '../../application/ports';
import { SupabaseService } from '../supabase/supabase.service';
import { check } from './supabase-result';

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

const MODEL_COLUMNS = 'llm_provider, llm_model, llm_fallback, llm_fallback_model, embedding_model';

/** Adaptador (Repository) sobre las tablas chatbots y chatbot_secrets. */
@Injectable()
export class SupabaseModelSettingsRepository implements ModelSettingsRepository {
  private readonly logger = new Logger(SupabaseModelSettingsRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  async find(projectId: string): Promise<ModelSettings> {
    const { data, error } = await this.supabase.admin.from('chatbots').select(MODEL_COLUMNS).eq('project_id', projectId).maybeSingle();
    if (error) {
      this.logger.warn(`No se pudo leer la configuración de modelos de ${projectId}: ${error.message}`);
      return { ...DEFAULT_MODEL_SETTINGS };
    }
    return toSettings(data);
  }

  async credentials(projectId: string): Promise<Record<LlmProvider, ProviderCredential>> {
    const columns = LLM_PROVIDERS.flatMap((p) => [`${p}_key_last4`, `${p}_key_updated_at`]).join(', ');
    const { data } = await this.supabase.admin.from('chatbot_secrets').select(columns).eq('project_id', projectId).maybeSingle();
    const row = (data ?? {}) as unknown as Record<string, string | null>;
    const out = {} as Record<LlmProvider, ProviderCredential>;
    for (const p of LLM_PROVIDERS) {
      const last4 = row[`${p}_key_last4`] ?? null;
      out[p] = { configured: Boolean(last4), last4, updatedAt: row[`${p}_key_updated_at`] ?? null };
    }
    return out;
  }

  async save(scope: DataScope, project: ProjectRef, settings: ModelSettings): Promise<void> {
    const db = this.supabase.client(scope);
    const values = {
      llm_provider: settings.llmProvider,
      llm_model: settings.llmModel,
      llm_fallback: settings.llmFallback,
      llm_fallback_model: settings.llmFallbackModel,
      embedding_model: settings.embeddingModel,
    };
    const { data: existing, error: findError } = await db.from('chatbots').select('id').eq('project_id', project.id).maybeSingle();
    check(findError);
    const { data, error } = existing
      ? await db.from('chatbots').update(values).eq('id', existing.id).select('id').maybeSingle()
      : await db
          .from('chatbots')
          .insert({ ...DEFAULT_CHATBOT, ...values, project_id: project.id, company_id: project.companyId })
          .select('id')
          .maybeSingle();
    if (error?.code === '42501' || (!error && !data)) throw new ForbiddenError('Solo owner o admin pueden cambiar los modelos');
    check(error);
  }
}
