import { Injectable, Logger } from '@nestjs/common';
import { QueueClient } from '@vercel/queue';
import { AppConfig } from '../config/app-config';
import { EnrichmentService, type EnrichJob } from '../enrichment/enrichment.service';
import {
  IngestionService,
  PermanentIngestionError,
  type IngestionJob,
} from '../ingestion/ingestion.service';

/** Mensajes del topic: procesar un documento o generar descripciones web. */
export type QueueJob = IngestionJob | EnrichJob;

function isEnrichJob(job: QueueJob): job is EnrichJob {
  return (job as EnrichJob).kind === 'enrich';
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
export class IngestionQueueService {
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
  ) {}

  async enqueue(job: QueueJob): Promise<void> {
    if (this.config.ingestInline) {
      setImmediate(() => void this.runInline(job));
      return;
    }
    // Evita lotes duplicados si el mismo trabajo se publica dos veces en el mismo minuto
    // (doble clic, reintento del cliente); permite reprocesar más tarde.
    const minute = Math.floor(Date.now() / 60_000);
    const id = isEnrichJob(job) ? `enrich:${job.projectId}:${job.force ? 'f' : ''}` : `${job.documentId}:${job.startChunk}`;
    await this.client.send(this.config.ingestionTopic, job, { idempotencyKey: `${id}:${minute}` });
  }

  /** Handler del consumidor de la cola: procesa un lote y encola el siguiente si hace falta. */
  async handleMessage(job: QueueJob, deliveryCount: number): Promise<void> {
    if (isEnrichJob(job)) return this.handleEnrich(job, deliveryCount);
    try {
      const result = await this.ingestion.process(job);
      if (result.next) await this.enqueue(result.next);
      if (result.enrichProjectId) await this.enqueue({ kind: 'enrich', projectId: result.enrichProjectId });
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
