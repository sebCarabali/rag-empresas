import type { ModelInfo } from '../../domain/llm/llm';
import type { DataScope } from './data-scope';
import type { ProjectRef } from './projects.repository';

export interface EvalCaseInput {
  question: string;
  must_include: string[];
  must_not_include: string[];
  notes: string | null;
}

export interface EvalCase extends EvalCaseInput {
  id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

export type EvalRunStatus = 'queued' | 'running' | 'done' | 'failed';

export interface EvalRun {
  id: string;
  project_id: string;
  status: EvalRunStatus;
  total: number;
  passed: number;
  failed: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface EvalResultInput {
  runId: string;
  companyId: string;
  caseId: string;
  question: string;
  answer: string;
  passed: boolean;
  missing: string[];
  forbidden: string[];
  modelInfo: ModelInfo | null;
  durationMs: number;
  error: string | null;
}

/** Puerto de salida (Repository): pruebas de calidad. NotFoundError si no se ve. */
export interface EvalRepository {
  listCases(scope: DataScope, projectId: string): Promise<EvalCase[]>;
  countCases(scope: DataScope, projectId: string): Promise<number>;
  createCase(scope: DataScope, project: ProjectRef, input: EvalCaseInput): Promise<EvalCase>;
  updateCase(scope: DataScope, projectId: string, caseId: string, input: EvalCaseInput): Promise<EvalCase>;
  deleteCase(scope: DataScope, projectId: string, caseId: string): Promise<void>;

  listRuns(scope: DataScope, projectId: string, limit: number): Promise<EvalRun[]>;
  hasActiveRun(scope: DataScope, projectId: string, since: Date): Promise<boolean>;
  createRun(scope: DataScope, project: ProjectRef, total: number): Promise<EvalRun>;
  getRun(scope: DataScope, projectId: string, runId: string): Promise<EvalRun & { results: unknown[] }>;

  /** Para el worker: */
  findRun(runId: string): Promise<{ id: string; company_id: string; project_id: string; status: EvalRunStatus } | null>;
  markRunning(runId: string): Promise<void>;
  casesForProject(projectId: string): Promise<Array<Pick<EvalCase, 'id' | 'question' | 'must_include' | 'must_not_include'>>>;
  completedCaseIds(runId: string): Promise<Set<string>>;
  saveResult(result: EvalResultInput): Promise<void>;
  /** Cierra la ejecución con el recuento de resultados. */
  finishRun(runId: string): Promise<{ passed: number; total: number }>;
  failRun(runId: string, message: string): Promise<void>;
}

export const EVAL_REPOSITORY = Symbol('EVAL_REPOSITORY');
