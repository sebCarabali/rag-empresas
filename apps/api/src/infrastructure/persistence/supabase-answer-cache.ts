import { Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { toPgVector } from '../../application/embeddings/embeddings.service';
import { SupabaseService } from '../supabase/supabase.service';
import { buildVocabulary } from '../../domain/cache/semantic-guard';
import type { CatalogToolCall } from './catalog-tools';
import type { ModelInfo } from '../../application/llm/llm.service';
import type { Source } from '../../domain/chat/prompt';

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

/**
 * Respuestas que dicen que no hay información ("no aparece", "no encontré"…).
 * Suelen venir de una búsqueda que no trajo lo necesario o del modelo de
 * respaldo sin herramientas: guardarlas fijaría un "no" incorrecto.
 */
const NEGATIVE_ANSWER =
  /\b(no (se )?(encontr|aparec|hay (informaci|datos)|tengo (informaci|datos)|dispongo|cuento con|figura|incluye|contiene|menciona|se enumeran)|sin informaci|lo siento)/;

export function isNegativeAnswer(answer: string): boolean {
  // Solo la primera oración: una respuesta útil puede aclarar más adelante lo que no está.
  const first = answer.trim().split(/(?<=[.!?])\s|\n/)[0].slice(0, 240);
  const opening = AnswerCacheService.normalizeQuestion(first);
  return NEGATIVE_ANSWER.test(opening);
}

/** Vocabulario del catálogo por proyecto y versión del contenido (dura poco en memoria). */
const vocabularyCache = new Map<string, { at: number; words: Set<string> }>();
const VOCABULARY_TTL_MS = 10 * 60_000;

/** Sube si cambia el prompt, el formato de las fuentes o la lógica de búsqueda. */
const CACHE_SCHEMA_VERSION = 'v1';

/** Palabras con las que empieza una pregunta que continúa la anterior ("¿y en plano?"). */
const FOLLOW_UP_START = /^(y|e|o|pero|entonces|tambien|ademas|igual|mismo|lo mismo|otra vez|de nuevo|mas|menos|ahora|y si|y que|y cual|y cuales|y cuantos|y cuantas|y el|y la|y los|y las|solo|sino|por que no)\b/;

/** Referencias a algo dicho antes en la conversación. */
const FOLLOW_UP_REFERENCE = /\b(es[ao]s?|est[ao]s?|aquell[ao]s?|ese|este|aquel|ell[ao]s?|anterior(es)?|mencionad[ao]s?|dich[ao]s?|previ[ao]s?|ultim[ao]s?|primer[ao]s?|segund[ao]s?|tercer[ao]s?|la otra|el otro|los otros|las otras|lo que dijiste|me dijiste|arriba|de la lista|de esa lista|cual de|cuales de|de ellas|de ellos)\b/;

/**
 * Caché de respuestas por proyecto. Se usa en cualquier pregunta que se
 * entienda por sí sola, aunque la conversación ya tenga mensajes; se salta en
 * las preguntas de seguimiento ("¿y en plano?", "¿cuál de esas…?"), cuyo
 * significado depende de lo anterior. La clave incluye una "versión" del
 * contenido del proyecto: subir, reprocesar o borrar un documento, o cambiar
 * las descripciones web, invalida automáticamente lo cacheado.
 */
@Injectable()
export class AnswerCacheService {
  private readonly logger = new Logger(AnswerCacheService.name);

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

  /** Términos distintivos del catálogo del proyecto (para el control léxico). */
  async vocabulary(db: SupabaseClient, projectId: string, version: string): Promise<Set<string>> {
    const id = `${projectId}:${version}`;
    const hit = vocabularyCache.get(id);
    if (hit && Date.now() - hit.at < VOCABULARY_TTL_MS) return hit.words;
    const { data, error } = await db.rpc('catalog_vocabulary', { p_project_id: projectId });
    if (error) this.logger.warn(`Vocabulario del catálogo no disponible: ${error.message}`);
    const words = buildVocabulary(((data ?? []) as unknown[]).map((w) => String(w)));
    if (vocabularyCache.size > 200) vocabularyCache.clear();
    vocabularyCache.set(id, { at: Date.now(), words });
    return words;
  }

  /**
   * ¿La pregunta depende de la conversación anterior? En la primera pregunta
   * nunca; después, si empieza como continuación, hace referencia a algo dicho
   * antes o es demasiado corta para entenderse sola.
   */
  static isFollowUp(question: string, hasHistory: boolean): boolean {
    if (!hasHistory) return false;
    const q = AnswerCacheService.normalizeQuestion(question);
    if (q.split(' ').length <= 2) return true;
    return FOLLOW_UP_START.test(q) || FOLLOW_UP_REFERENCE.test(q);
  }

  /** "¿Cuántas telas de ALGODÓN hay?" y "cuantas telas de algodon hay" comparten clave. */
  static normalizeQuestion(question: string): string {
    return question
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[¿?¡!.,;:"'()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Versión del contenido del proyecto (documentos y descripciones web), leída con el cliente del usuario (RLS). */
  async contentVersion(db: SupabaseClient, projectId: string): Promise<string> {
    const { data, error } = await db
      .from('documents')
      .select('updated_at')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1);
    const { count } = await db
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);
    const { data: enriched } = await db
      .from('catalog_enrichments')
      .select('updated_at')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return `${count ?? 0}:${data?.[0]?.updated_at ?? 'none'}:${enriched?.[0]?.updated_at ?? 'none'}`;
  }

  /**
   * @param variant identifica el canal (chat interno / widget).
   * @param model modelo de lenguaje principal (cacheModelKey): cambiarlo deja de usar lo guardado.
   */
  key(projectId: string, version: string, question: string, variant = '', model = this.config.geminiModel): string {
    return createHash('sha256')
      .update(
        [CACHE_SCHEMA_VERSION, projectId, version, model, variant, AnswerCacheService.normalizeQuestion(question)].join('|'),
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
