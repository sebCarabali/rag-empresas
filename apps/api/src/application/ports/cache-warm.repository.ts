import type { DataScope } from './data-scope';
import type { ProjectRef } from './projects.repository';

export interface WarmQuestion {
  question: string;
  audience: 'internal' | 'public';
  origin: 'sugerida' | 'widget' | 'equipo';
}

export type WarmRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

export interface WarmRunRow {
  id: string;
  status: WarmRunStatus;
  trigger: 'manual' | 'auto';
  total: number;
  done: number;
  generated: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

/** Puerto de salida (Repository): ejecuciones del precalentamiento de la caché. */
export interface WarmRunRepository {
  list(scope: DataScope, projectId: string, limit: number): Promise<WarmRunRow[]>;
  hasActive(projectId: string, since: Date): Promise<boolean>;
  create(project: ProjectRef, trigger: WarmRunRow['trigger']): Promise<WarmRunRow>;
  find(runId: string): Promise<{ id: string; status: WarmRunStatus; questions: WarmQuestion[]; done: number; generated: number } | null>;
  start(runId: string, questions: WarmQuestion[]): Promise<void>;
  saveProgress(runId: string, done: number, generated: number): Promise<void>;
  finish(runId: string, done: number, generated: number): Promise<void>;
  fail(runId: string, message: string): Promise<void>;
}

export const WARM_RUN_REPOSITORY = Symbol('WARM_RUN_REPOSITORY');
