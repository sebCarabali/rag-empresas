import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfig } from '../../config/app-config';
import { isNegativeAnswer, normalizeQuestion } from '../../domain/cache/questions';
import type { AnswerCache, CachedAnswer, SemanticFields, SimilarQuestion } from '../../application/ports';
import { SupabaseService } from '../supabase/supabase.service';
import { toPgVector } from './pg-vector';

/** Sube si cambia el prompt, el formato de las fuentes o la lógica de búsqueda. */
const CACHE_SCHEMA_VERSION = 'v1';

/**
 * Adaptador del puerto AnswerCache sobre la tabla answer_cache. La clave
 * incluye una "versión" del contenido del proyecto: subir, reprocesar o borrar
 * un documento, o cambiar las descripciones web, invalida lo guardado.
 */
@Injectable()
export class SupabaseAnswerCache implements AnswerCache {
  private readonly logger = new Logger(SupabaseAnswerCache.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.config.answerCacheTtlHours > 0;
  }

  get semanticEnabled(): boolean {
    return this.enabled && this.config.semanticCacheMinSimilarity < 1;
  }

  /** Preguntas en caché con significado parecido (misma versión del contenido y del asistente). */
  async similar(
    projectId: string,
    semantic: Pick<SemanticFields, 'version' | 'model' | 'embeddingModel'>,
    variant: string | null,
    embedding: number[],
    minSimilarity = this.config.semanticCacheMinSimilarity,
  ): Promise<SimilarQuestion[]> {
    const { data, error } = await this.supabase.admin.rpc('match_answer_cache', {
      p_project_id: projectId,
      p_version: semantic.version,
      p_variant: variant,
      p_model: semantic.model,
      p_embedding: toPgVector(embedding),
      p_min_similarity: minSimilarity,
      p_limit: 5,
      p_embedding_model: semantic.embeddingModel,
    });
    if (error) {
      this.logger.warn(`Caché por significado no disponible: ${error.message}`);
      return [];
    }
    return (data ?? []) as SimilarQuestion[];
  }

  /**
   * @param variant identifica el canal (chat interno / widget).
   * @param model modelo de lenguaje principal (cacheModelKey): cambiarlo deja de usar lo guardado.
   */
  key(projectId: string, version: string, question: string, variant: string, model: string): string {
    return createHash('sha256')
      .update(
        [CACHE_SCHEMA_VERSION, projectId, version, model, variant, normalizeQuestion(question)].join('|'),
      )
      .digest('hex');
  }

  async get(key: string): Promise<CachedAnswer | null> {
    const { data, error } = await this.supabase.admin
      .from('answer_cache')
      .select('answer, sources, tool_calls, model_info, hits')
      .eq('cache_key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) {
      this.logger.warn(`Caché no disponible: ${error.message}`);
      return null;
    }
    if (!data) return null;
    // Contador de aciertos (no bloquea la respuesta si falla).
    void this.supabase.admin
      .from('answer_cache')
      .update({ hits: (data.hits ?? 0) + 1 })
      .eq('cache_key', key)
      .then(({ error: e }) => e && this.logger.warn(`No se pudo contar el acierto: ${e.message}`));
    return {
      answer: data.answer,
      sources: data.sources ?? [],
      toolCalls: data.tool_calls ?? [],
      modelInfo: data.model_info ?? null,
    };
  }

  async put(
    key: string,
    projectId: string,
    question: string,
    value: CachedAnswer,
    semantic?: SemanticFields,
  ): Promise<void> {
    if (isNegativeAnswer(value.answer)) {
      this.logger.log(`No se guarda en caché una respuesta sin información: "${question}"`);
      return;
    }
    const expires = new Date(Date.now() + this.config.answerCacheTtlHours * 3600_000);
    const { error } = await this.supabase.admin.from('answer_cache').upsert({
      cache_key: key,
      project_id: projectId,
      question,
      answer: value.answer,
      sources: value.sources,
      tool_calls: value.toolCalls,
      model_info: value.modelInfo ?? null,
      hits: 0,
      created_at: new Date().toISOString(),
      expires_at: expires.toISOString(),
      question_embedding: semantic?.embedding ? toPgVector(semantic.embedding) : null,
      question_embedding_model: semantic?.embedding ? semantic.embeddingModel : null,
      content_version: semantic?.version ?? null,
      variant: semantic?.variant ?? null,
      model: semantic?.model ?? this.config.geminiModel,
    });
    if (error) this.logger.warn(`No se pudo guardar en caché: ${error.message}`);

    // Las entradas de versiones anteriores del contenido ya no se pueden usar: se borran.
    if (semantic?.version) {
      const { error: cleanError } = await this.supabase.admin
        .from('answer_cache')
        .delete()
        .eq('project_id', projectId)
        .or(`content_version.is.null,content_version.neq.${JSON.stringify(semantic.version)},expires_at.lt.${JSON.stringify(new Date().toISOString())}`);
      if (cleanError) this.logger.warn(`No se limpió la caché: ${cleanError.message}`);
    }
  }
}
