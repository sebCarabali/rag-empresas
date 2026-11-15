import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModelSettingsService } from '../models/model-settings.service';
import {
  ANSWER_CACHE,
  CHUNK_REPOSITORY,
  PROJECT_REPOSITORY,
  type AnswerCache,
  type ChunkRepository,
  type ProjectRepository,
} from '../ports';
import { EmbeddingsService } from './embeddings.service';

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
 * elegido en la configuración del asistente (o EMBEDDING_MODEL por defecto). No vuelve a leer los archivos: usa el texto
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
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(CHUNK_REPOSITORY) private readonly chunks: ChunkRepository,
    @Inject(ANSWER_CACHE) private readonly cache: AnswerCache,
    private readonly embeddings: EmbeddingsService,
    private readonly models: ModelSettingsService,
  ) {}

  async status(projectId: string): Promise<ReindexStatus> {
    const state = await this.projects.reindexState(projectId);
    const target = await this.models.embeddingModel(projectId);
    const { embeddingModel, ...progress } = state;
    return { model: target, indexedWith: embeddingModel, ...progress, outdated: embeddingModel !== target };
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
    const count = await this.chunks.count(projectId);
    if (!(await this.projects.claimReindex(projectId, count, new Date(Date.now() - STALE_MS)))) return false;

    const model = await this.models.embeddingModel(projectId);
    try {
      await this.requester({ kind: 'reembed', projectId, model });
    } catch (err) {
      await this.markFailed(projectId, (err as Error).message);
      throw err;
    }
    this.logger.log(`Reindexado de ${projectId} encolado (${count} fragmentos, ${model})`);
    return true;
  }

  /** Procesa un lote; devuelve el siguiente trabajo si queda trabajo. */
  async run(job: ReembedJob): Promise<{ next?: ReembedJob }> {
    this.models.invalidate(job.projectId);
    const current = await this.models.embeddingModel(job.projectId);
    if (job.model !== current) {
      this.logger.warn(`Reindexado de ${job.projectId} con ${job.model} abandonado: el modelo actual es ${current}`);
      return {};
    }
    const started = Date.now();

    if (!job.cursor) {
      // Las preguntas en caché se compararon con el modelo anterior: se quita solo su embedding.
      await this.cache.forgetEmbeddings(job.projectId);
    }

    let cursor = job.cursor;
    let done = (await this.projects.reindexState(job.projectId)).done ?? 0;
    const embed = { model: job.model, projectId: job.projectId };

    for (;;) {
      const rows = await this.chunks.page(job.projectId, cursor, PAGE);
      if (!rows.length) break;

      for (let i = 0; i < rows.length; i += EMBED_BATCH) {
        const batch = rows.slice(i, i + EMBED_BATCH);
        const vectors = await this.embeddings.embedPassages(batch.map((r) => r.content), embed);
        await this.chunks.saveEmbeddings(batch.map((chunk, j) => ({ chunk, embedding: vectors[j], model: job.model })));
      }
      cursor = rows[rows.length - 1].id;
      done += rows.length;
      await this.projects.saveReindexProgress(job.projectId, done);

      if (rows.length < PAGE) break;
      if (Date.now() - started > TIME_BUDGET_MS) {
        return { next: { ...job, cursor } };
      }
    }

    await this.projects.finishReindex(job.projectId, job.model, done);
    this.logger.log(`Proyecto ${job.projectId} reindexado: ${done} fragmentos con ${job.model}`);
    return {};
  }

  async markFailed(projectId: string, message: string): Promise<void> {
    await this.projects.failReindex(projectId, message);
  }
}
