import { Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from '../supabase/supabase.service';
import type { CatalogToolCall } from './catalog-tools';
import type { Source } from './prompt';

export interface CachedAnswer {
  answer: string;
  sources: Source[];
  toolCalls: CatalogToolCall[];
}

/** Sube si cambia el prompt, el formato de las fuentes o la lógica de búsqueda. */
const CACHE_SCHEMA_VERSION = 'v1';

/**
 * Caché de respuestas por proyecto. Solo se usa en la primera pregunta de una
 * conversación (sin historial), que es cuando la misma pregunta da la misma
 * respuesta. La clave incluye una "versión" del contenido del proyecto
 * (cantidad de documentos y su última modificación): subir, reprocesar o
 * borrar un documento invalida automáticamente lo cacheado.
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

  key(projectId: string, version: string, question: string): string {
    return createHash('sha256')
      .update([CACHE_SCHEMA_VERSION, projectId, version, this.config.geminiModel, AnswerCacheService.normalizeQuestion(question)].join('|'))
      .digest('hex');
  }

  async get(key: string): Promise<CachedAnswer | null> {
    const { data, error } = await this.supabase.admin
      .from('answer_cache')
      .select('answer, sources, tool_calls, hits')
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
    return { answer: data.answer, sources: data.sources ?? [], toolCalls: data.tool_calls ?? [] };
  }

  async put(key: string, projectId: string, question: string, value: CachedAnswer): Promise<void> {
    const expires = new Date(Date.now() + this.config.answerCacheTtlHours * 3600_000);
    const { error } = await this.supabase.admin.from('answer_cache').upsert({
      cache_key: key,
      project_id: projectId,
      question,
      answer: value.answer,
      sources: value.sources,
      tool_calls: value.toolCalls,
      hits: 0,
      created_at: new Date().toISOString(),
      expires_at: expires.toISOString(),
    });
    if (error) this.logger.warn(`No se pudo guardar en caché: ${error.message}`);

    // Limpieza ocasional de entradas vencidas del proyecto.
    if (Math.random() < 0.1) {
      await this.supabase.admin
        .from('answer_cache')
        .delete()
        .eq('project_id', projectId)
        .lt('expires_at', new Date().toISOString());
    }
  }
}
