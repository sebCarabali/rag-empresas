import { Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildVocabulary } from '../../domain/cache/semantic-guard';
import type { RetrievedChunk } from '../../domain/chat/prompt';
import type { CatalogTools, DataScope, KnowledgeBase, KnowledgeBaseFactory, WebDescription } from '../../application/ports';
import { createCatalogExecutor, loadCatalogContext } from './catalog-tools';
import { loadEnrichments } from './enrichment-context';
import { toPgVector } from './pg-vector';
import { SupabaseService } from '../supabase/supabase.service';

/** Vocabulario del catálogo por proyecto y versión del contenido (dura poco en memoria). */
const vocabularyCache = new Map<string, { at: number; words: Set<string> }>();
const VOCABULARY_TTL_MS = 10 * 60_000;

/**
 * Adaptador del puerto KnowledgeBase sobre Supabase. Se crea por ámbito: con
 * el cliente del usuario (JWT, aplica RLS) en la app, o con service_role en el
 * widget, la API pública y el worker (que ya validaron el acceso al proyecto).
 */
export class SupabaseKnowledgeBase implements KnowledgeBase {
  private readonly logger = new Logger(SupabaseKnowledgeBase.name);

  constructor(private readonly db: SupabaseClient) {}

  async searchChunks(params: { projectId: string; question: string; embedding: number[]; embeddingModel: string; limit: number }): Promise<RetrievedChunk[]> {
    const { data, error } = await this.db.rpc('match_document_chunks', {
      p_project_id: params.projectId,
      query_embedding: toPgVector(params.embedding),
      query_text: params.question,
      match_count: params.limit,
      p_embedding_model: params.embeddingModel,
    });
    if (error) throw new Error(`Búsqueda: ${error.message}`);
    return (data ?? []) as RetrievedChunk[];
  }

  async contentVersion(projectId: string): Promise<string> {
    const { data, error } = await this.db
      .from('documents')
      .select('updated_at')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1);
    const { count } = await this.db.from('documents').select('id', { count: 'exact', head: true }).eq('project_id', projectId);
    const { data: enriched } = await this.db
      .from('catalog_enrichments')
      .select('updated_at')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return `${count ?? 0}:${data?.[0]?.updated_at ?? 'none'}:${enriched?.[0]?.updated_at ?? 'none'}`;
  }

  async catalogVocabulary(projectId: string, version: string): Promise<Set<string>> {
    const id = `${projectId}:${version}`;
    const hit = vocabularyCache.get(id);
    if (hit && Date.now() - hit.at < VOCABULARY_TTL_MS) return hit.words;
    const { data, error } = await this.db.rpc('catalog_vocabulary', { p_project_id: projectId });
    if (error) this.logger.warn(`Vocabulario del catálogo no disponible: ${error.message}`);
    const words = buildVocabulary(((data ?? []) as unknown[]).map((w) => String(w)));
    if (vocabularyCache.size > 200) vocabularyCache.clear();
    vocabularyCache.set(id, { at: Date.now(), words });
    return words;
  }

  async webDescriptions(projectId: string, question: string, chunks: RetrievedChunk[]): Promise<WebDescription[]> {
    const found = await loadEnrichments(this.db, projectId, question, chunks);
    return found.map((e) => ({
      field: e.field,
      value: e.value,
      sources: e.sources,
      label: `${e.field} "${e.value}" — descripción general (web)`,
      content: e.description,
    }));
  }

  async catalogTools(projectId: string): Promise<CatalogTools | null> {
    const catalog = await loadCatalogContext(this.db, projectId);
    if (!catalog) return null;
    return {
      declarations: catalog.declarations,
      instructions: catalog.instructions,
      createExecutor: (sources, calls) => createCatalogExecutor(this.db, projectId, sources, calls),
    };
  }
}

/** Fábrica (Abstract Factory): una base de conocimiento por ámbito de datos. */
@Injectable()
export class SupabaseKnowledgeBaseFactory implements KnowledgeBaseFactory {
  constructor(private readonly supabase: SupabaseService) {}

  forScope(scope: DataScope): KnowledgeBase {
    return new SupabaseKnowledgeBase(this.supabase.client(scope));
  }
}
