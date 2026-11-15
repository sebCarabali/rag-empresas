import { Injectable, Logger } from '@nestjs/common';
import { QueueClient } from '@vercel/queue';
import { AppConfig } from '../../config/app-config';
import type { JobQueue } from '../../application/ports';
import { ReindexService, type ReembedJob } from '../../application/embeddings/reindex.service';
import { EnrichmentService, type EnrichJob } from '../../application/enrichment/enrichment.service';
import { EvalRunnerService, type EvalJob } from '../../application/evals/eval-runner.service';
import { CacheWarmService, type WarmJob } from '../../application/cache/cache-warm.service';
import {
  IngestionService,
  PermanentIngestionError,
  type IngestionJob,
} from '../../application/ingestion/ingestion.service';

/** Mensajes del topic: procesar un documento, generar descripciones web o ejecutar pruebas de calidad. */
export type QueueJob = IngestionJob | EnrichJob | EvalJob | WarmJob | ReembedJob;

function isEnrichJob(job: QueueJob): job is EnrichJob {
  return (job as EnrichJob).kind === 'enrich';
}

function isEvalJob(job: QueueJob): job is EvalJob {
  return (job as EvalJob).kind === 'eval';
}

function isWarmJob(job: QueueJob): job is WarmJob {
  return (job as WarmJob).kind === 'warm';
}

function isReembedJob(job: QueueJob): job is ReembedJob {
  return (job as ReembedJob).kind === 'reembed';
}

function jobId(job: QueueJob): string {
  if (isReembedJob(job)) return `reembed:${job.projectId}:${job.cursor ?? 'start'}`;
  if (isWarmJob(job)) return `warm:${job.projectId}:${job.runId ?? 'auto'}:${job.batch ?? 0}`;
  if (isEvalJob(job)) return `eval:${job.runId}:${job.batch ?? 0}`;
  if (isEnrichJob(job)) return `enrich:${job.projectId}:${job.force ? 'f' : ''}`;
  return `${job.documentId}:${job.startChunk}`;
}

/** Reintentos antes de marcar un documento como fallido. */
export const MAX_DELIVERIES = 4;

/**
 * Publica trabajos de ingesta en Vercel Queues y contiene la lógica que corre
 * cuando la cola entrega un mensaje (ver api/queues/ingest.js).
 *
 * En local (INGEST_INLINE=true) no hay cola: el trabajo se ejecuta en el mismo
 * proceso para poder desarrollar sin desplegar.
 */
@Injectable()
export class IngestionQueueService implements JobQueue {
  private readonly logger = new Logger(IngestionQueueService.name);
  private _client?: QueueClient;

  /** Se crea al primer uso para no requerir Vercel en desarrollo local. */
  private get client(): QueueClient {
    return (this._client ??= new QueueClient());
  }

  constructor(
    private readonly config: AppConfig,
    private readonly ingestion: IngestionService,
    private readonly enrichment: EnrichmentService,
    private readonly evals: EvalRunnerService,
    private readonly warm: CacheWarmService,
    private readonly reindex: ReindexService,
  ) {
    this.reindex.requester = (job) => this.enqueue(job);
  }

  async enqueue(job: QueueJob): Promise<void> {
    if (this.config.ingestInline) {
      setImmediate(() => void this.runInline(job));
      return;
    }
    // Evita lotes duplicados si el mismo trabajo se publica dos veces en el mismo minuto
    // (doble clic, reintento del cliente); permite reprocesar más tarde.
    const minute = Math.floor(Date.now() / 60_000);
    await this.client.send(this.config.ingestionTopic, job, { idempotencyKey: `${jobId(job)}:${minute}` });
  }

  /** Handler del consumidor de la cola: procesa un lote y encola el siguiente si hace falta. */
  async handleMessage(job: QueueJob, deliveryCount: number): Promise<void> {
    if (isEnrichJob(job)) return this.handleEnrich(job, deliveryCount);
    if (isEvalJob(job)) return this.handleEval(job, deliveryCount);
    if (isWarmJob(job)) return this.handleWarm(job, deliveryCount);
    if (isReembedJob(job)) return this.handleReembed(job, deliveryCount);
    try {
      const result = await this.ingestion.process(job);
      if (result.next) {
        await this.enqueue(result.next);
      } else if (result.enrichProjectId && this.config.webEnrichment) {
        // Las descripciones web cambian la versión del contenido: se precalienta al terminar.
        await this.enqueue({ kind: 'enrich', projectId: result.enrichProjectId });
      } else if (result.projectId) {
        await this.autoWarm(result.projectId);
      }
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const permanent = err instanceof PermanentIngestionError;
      if (permanent || deliveryCount >= MAX_DELIVERIES) {
        this.logger.error(`Documento ${job.documentId} falló definitivamente: ${message}`);
        await this.ingestion.markFailed(job.documentId, message);
        return; // se confirma el mensaje para que no se reintente
      }
      this.logger.warn(`Documento ${job.documentId}, intento ${deliveryCount}: ${message}`);
      throw err; // la cola lo reintenta
    }
  }

  /** El enriquecimiento es opcional: si falla, no afecta al documento. */
  private async handleEnrich(job: EnrichJob, deliveryCount: number): Promise<void> {
    try {
      const result = await this.enrichment.run(job);
      if (result.next) await this.enqueue(result.next);
      else await this.autoWarm(job.projectId);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (deliveryCount >= MAX_DELIVERIES) {
        this.logger.error(`Enriquecimiento del proyecto ${job.projectId} abandonado: ${message}`);
        return;
      }
      this.logger.warn(`Enriquecimiento del proyecto ${job.projectId}, intento ${deliveryCount}: ${message}`);
      throw err;
    }
  }

  private async handleEval(job: EvalJob, deliveryCount: number): Promise<void> {
    try {
      const result = await this.evals.run(job);
      if (result.next) await this.enqueue(result.next);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (deliveryCount >= MAX_DELIVERIES) {
        this.logger.error(`Prueba de calidad ${job.runId} falló: ${message}`);
        await this.evals.markFailed(job.runId, message);
        return;
      }
      this.logger.warn(`Prueba de calidad ${job.runId}, intento ${deliveryCount}: ${message}`);
      throw err;
    }
  }

  /** Precalentamiento automático tras cambiar el contenido (si está activado). */
  private async autoWarm(projectId: string): Promise<void> {
    if (!this.warm.autoEnabled || !this.config.answerCacheTtlHours) return;
    await this.enqueue({ kind: 'warm', projectId }).catch((err) =>
      this.logger.warn(`No se pudo encolar el precalentamiento: ${(err as Error).message}`),
    );
  }

  private async handleWarm(job: WarmJob, deliveryCount: number): Promise<void> {
    try {
      const result = await this.warm.run(job);
      if (result.next) await this.enqueue(result.next);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (deliveryCount >= MAX_DELIVERIES) {
        this.logger.error(`Precalentamiento de ${job.projectId} falló: ${message}`);
        await this.warm.markFailed(job.runId, message);
        return;
      }
      throw err;
    }
  }

  private async handleReembed(job: ReembedJob, deliveryCount: number): Promise<void> {
    try {
      const result = await this.reindex.run(job);
      if (result.next) await this.enqueue(result.next);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (deliveryCount >= MAX_DELIVERIES) {
        this.logger.error(`Reindexado de ${job.projectId} falló: ${message}`);
        await this.reindex.markFailed(job.projectId, message);
        return;
      }
      this.logger.warn(`Reindexado de ${job.projectId}, intento ${deliveryCount}: ${message}`);
      throw err;
    }
  }

  /** Fábrica del handler (req, res) que Vercel invoca al entregar mensajes. */
  createNodeConsumer() {
    return this.client.handleNodeCallback<QueueJob>(
      (job, metadata) => this.handleMessage(job, metadata.deliveryCount),
      {
        visibilityTimeoutSeconds: 330, // un poco más que la duración máxima de la función
        retry: (_err, metadata) => ({ afterSeconds: Math.min(300, 15 * 2 ** metadata.deliveryCount) }),
      },
    );
  }

  private async runInline(job: QueueJob): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.handleMessage(job, attempt);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
}
