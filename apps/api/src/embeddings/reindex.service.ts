import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from '../supabase/supabase.service';
import { EmbeddingsService, toPgVector } from './embeddings.service';

export interface ReembedJob {
  kind: 'reembed';
  projectId: string;
  /** Modelo con el que se empezó; si el despliegue cambia de modelo a mitad, el trabajo se abandona. */
  model: string;
  /** Último id procesado (los fragmentos se recorren por id). */
  cursor?: string;
}

export interface ReindexStatus {
  model: string;
  indexedWith: string | null;
  status: 'running' | 'done' | 'failed' | null;
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** true si el proyecto está indexado con otro modelo y hay que reindexar. */
  outdated: boolean;
}

const PAGE = 64;
const EMBED_BATCH = 16;
const TIME_BUDGET_MS = 200_000;
/** Un reindexado "running" sin avance durante este tiempo se considera abandonado. */
const STALE_MS = 20 * 60_000;

/**
 * Recalcula los embeddings de los fragmentos de un proyecto con el modelo
 * configurado (EMBEDDING_MODEL). No vuelve a leer los archivos: usa el texto
 * ya guardado de cada fragmento, así que no gasta OCR ni tokens del modelo.
 *
 * Se lanza solo cuando un proyecto está indexado con otro modelo (al abrirlo
 * o al preguntar) o a mano desde la app.
 */
@Injectable()
export class ReindexService {
  private readonly logger = new Logger(ReindexService.name);
  /** Lo registra la cola al arrancar (evita una dependencia circular con el motor del chat). */
  requester: ((job: ReembedJob) => Promise<void>) | null = null;
  private readonly lastCheck = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly supabase: SupabaseService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async status(projectId: string): Promise<ReindexStatus> {
    const { data, error } = await this.supabase.admin
      .from('projects')
      .select('embedding_model, reindex_status, reindex_done, reindex_total, reindex_started_at, reindex_finished_at, reindex_error')
      .eq('id', projectId)
      .single();
    if (error) throw new Error(error.message);
    return {
      model: this.config.embeddingModel,
      indexedWith: data.embedding_model,
      status: data.reindex_status,
      done: data.reindex_done,
      total: data.reindex_total,
      startedAt: data.reindex_started_at,
      finishedAt: data.reindex_finished_at,
      error: data.reindex_error,
      outdated: data.embedding_model !== this.config.embeddingModel,
    };
  }

  /**
   * Si el proyecto está indexado con otro modelo, encola el reindexado (una
   * sola vez: la marca "running" se toma de forma atómica). Barato: como mucho
   * una consulta por proyecto y minuto en cada instancia.
   */
  async ensureCurrent(projectId: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastCheck.get(projectId) ?? 0) < 60_000) return;
    this.lastCheck.set(projectId, now);
    try {
      const s = await this.status(projectId);
      if (s.outdated) await this.start(projectId);
    } catch (err) {
      this.logger.warn(`No se pudo comprobar el índice de ${projectId}: ${(err as Error).message}`);
    }
  }

  /** Empieza a reindexar. Devuelve false si ya hay un reindexado en curso. */
  async start(projectId: string): Promise<boolean> {
    if (!this.requester) throw new Error('La cola no está disponible');
    const db = this.supabase.admin;
    const { count, error: countError } = await db
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);
    if (countError) throw new Error(countError.message);

    const stale = new Date(Date.now() - STALE_MS).toISOString();
    const { data, error } = await db
      .from('projects')
      .update({
        reindex_status: 'running',
        reindex_done: 0,
        reindex_total: count ?? 0,
        reindex_started_at: new Date().toISOString(),
        reindex_finished_at: null,
        reindex_error: null,
      })
      .eq('id', projectId)
      .or(`reindex_status.is.null,reindex_status.neq.running,reindex_started_at.lt.${stale}`)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) return false;

    try {
      await this.requester({ kind: 'reembed', projectId, model: this.config.embeddingModel });
    } catch (err) {
      await this.markFailed(projectId, (err as Error).message);
      throw err;
    }
    this.logger.log(`Reindexado de ${projectId} encolado (${count ?? 0} fragmentos, ${this.config.embeddingModel})`);
    return true;
  }

  /** Procesa un lote; devuelve el siguiente trabajo si queda trabajo. */
  async run(job: ReembedJob): Promise<{ next?: ReembedJob }> {
    if (job.model !== this.config.embeddingModel) {
      this.logger.warn(`Reindexado de ${job.projectId} con ${job.model} abandonado: el modelo actual es ${this.config.embeddingModel}`);
      return {};
    }
    const db = this.supabase.admin;
    const started = Date.now();

    if (!job.cursor) {
      // Las preguntas en caché se compararon con el modelo anterior: se quita solo su embedding.
      await db.from('answer_cache').update({ question_embedding: null }).eq('project_id', job.projectId);
    }

    let cursor = job.cursor;
    const { data: progress } = await db.from('projects').select('reindex_done').eq('id', job.projectId).single();
    let done = progress?.reindex_done ?? 0;

    for (;;) {
      let query = db
        .from('document_chunks')
        .select('id, document_id, project_id, company_id, chunk_index, content, metadata')
        .eq('project_id', job.projectId)
        .order('id')
        .limit(PAGE);
      if (cursor) query = query.gt('id', cursor);
      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);
      if (!rows?.length) break;

      for (let i = 0; i < rows.length; i += EMBED_BATCH) {
        const batch = rows.slice(i, i + EMBED_BATCH);
        const vectors = await this.embeddings.embedPassages(batch.map((r) => r.content));
        const { error: upsertError } = await db
          .from('document_chunks')
          .upsert(
            batch.map((r, j) => ({ ...r, embedding: toPgVector(vectors[j]) })),
            { onConflict: 'id' },
          );
        if (upsertError) throw new Error(upsertError.message);
      }
      cursor = rows[rows.length - 1].id;
      done += rows.length;
      await db.from('projects').update({ reindex_done: done }).eq('id', job.projectId);

      if (rows.length < PAGE) break;
      if (Date.now() - started > TIME_BUDGET_MS) {
        return { next: { ...job, cursor } };
      }
    }

    await db
      .from('projects')
      .update({
        embedding_model: job.model,
        reindex_status: 'done',
        reindex_done: done,
        reindex_finished_at: new Date().toISOString(),
      })
      .eq('id', job.projectId);
    this.logger.log(`Proyecto ${job.projectId} reindexado: ${done} fragmentos con ${job.model}`);
    return {};
  }

  async markFailed(projectId: string, message: string): Promise<void> {
    await this.supabase.admin
      .from('projects')
      .update({ reindex_status: 'failed', reindex_error: message.slice(0, 500), reindex_finished_at: new Date().toISOString() })
      .eq('id', projectId);
  }
}
