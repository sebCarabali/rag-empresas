import type { DataScope } from './data-scope';
import type { ProjectRef } from './projects.repository';

export interface EnrichmentRow {
  id: string;
  field: string;
  value: string;
  description: string | null;
  sources: Array<{ title: string; url: string }> | null;
  status: 'pending' | 'ready' | 'failed';
  error: string | null;
  updated_at: string;
}

/** Puerto de salida (Repository): descripciones web del catálogo. */
export interface EnrichmentRepository {
  list(scope: DataScope, projectId: string): Promise<EnrichmentRow[]>;
  /** Vuelve a poner como pendientes las fallidas. */
  retryFailed(projectId: string): Promise<void>;
  /** Vuelve a poner como pendientes todas. */
  resetAll(projectId: string): Promise<void>;
  /** Registra como pendientes los valores nuevos; conserva los existentes. */
  registerValues(project: ProjectRef, values: Array<{ field: string; value: string }>): Promise<void>;
  pending(projectId: string): Promise<Array<Pick<EnrichmentRow, 'id' | 'field' | 'value'>>>;
  markReady(
    id: string,
    result: { description: string; sources: Array<{ title: string; url: string }>; queries: string[]; model: string },
  ): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  failPending(projectId: string, error: string): Promise<void>;
}

export const ENRICHMENT_REPOSITORY = Symbol('ENRICHMENT_REPOSITORY');
