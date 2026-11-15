import type { DataScope } from './data-scope';

export interface ProjectRow {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** Lo mínimo de un proyecto para operar sobre él. */
export interface ProjectRef {
  id: string;
  companyId: string;
}

export interface ReindexState {
  /** Modelo con el que están calculados los embeddings del proyecto. */
  embeddingModel: string | null;
  status: 'running' | 'done' | 'failed' | null;
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/**
 * Puerto de salida (Repository): proyectos. Los métodos con `scope` respetan
 * los permisos del usuario; los demás son operaciones del servidor.
 * `get`, `ref`, `update` y `delete` lanzan NotFoundError si no existe o no se ve.
 */
export interface ProjectRepository {
  list(scope: DataScope, companyId: string): Promise<ProjectRow[]>;
  create(scope: DataScope, input: { companyId: string; name: string; description: string | null }): Promise<ProjectRow>;
  get(scope: DataScope, id: string): Promise<ProjectRow>;
  update(scope: DataScope, id: string, patch: { name?: string; description?: string }): Promise<ProjectRow>;
  delete(scope: DataScope, id: string): Promise<void>;
  ref(scope: DataScope, id: string): Promise<ProjectRef>;
  /** Como ref, sin permisos de usuario y sin lanzar si no existe. */
  findRef(id: string): Promise<ProjectRef | null>;

  reindexState(id: string): Promise<ReindexState>;
  /** Marca el reindexado como en curso, salvo que ya lo esté desde después de `staleBefore`. Atómico. */
  claimReindex(id: string, total: number, staleBefore: Date): Promise<boolean>;
  saveReindexProgress(id: string, done: number): Promise<void>;
  finishReindex(id: string, model: string, done: number): Promise<void>;
  failReindex(id: string, message: string): Promise<void>;
}

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');
