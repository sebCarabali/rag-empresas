import type { WarmJob } from '../cache/cache-warm.service';
import type { ReembedJob } from '../embeddings/reindex.service';
import type { EnrichJob } from '../enrichment/enrichment.service';
import type { EvalJob } from '../evals/eval-runner.service';
import type { IngestionJob } from '../ingestion/ingestion.service';

/** Trabajos en segundo plano: procesar un documento, descripciones web, pruebas, precalentamiento, reindexado. */
export type BackgroundJob = IngestionJob | EnrichJob | EvalJob | WarmJob | ReembedJob;

/** Puerto de salida: encola trabajos en segundo plano para el worker. */
export interface JobQueue {
  enqueue(job: BackgroundJob): Promise<void>;
}

export const JOB_QUEUE = Symbol('JOB_QUEUE');
