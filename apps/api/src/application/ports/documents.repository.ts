import type { CatalogItem } from '../../domain/ingestion/csv-catalog';
import type { DataScope } from './data-scope';

export type DocumentStatus = 'uploading' | 'pending' | 'processing' | 'ready' | 'failed';

export interface DocumentRow {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  error: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  progress_stage: string | null;
  progress_done: number;
  progress_total: number;
  processing_started_at: string | null;
}

/** Lo que se necesita para procesar el archivo de un documento. */
export interface DocumentFile {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  storage_path: string;
  mime_type: string;
  status: DocumentStatus;
}

export type DocumentProgress = Partial<
  Pick<DocumentRow, 'status' | 'error' | 'chunk_count' | 'progress_stage' | 'progress_done' | 'progress_total' | 'processing_started_at'>
>;

/** Puerto de salida (Repository): documentos subidos. */
export interface DocumentRepository {
  list(scope: DataScope, projectId: string): Promise<DocumentRow[]>;
  create(
    scope: DataScope,
    input: { id: string; companyId: string; projectId: string; name: string; storagePath: string; mimeType: string; sizeBytes: number },
  ): Promise<DocumentRow>;
  find(scope: DataScope, id: string): Promise<DocumentFile | null>;
  /** Borra (los fragmentos caen en cascada) y devuelve la ruta del archivo. NotFoundError si no se pudo. */
  delete(scope: DataScope, id: string): Promise<{ storagePath: string }>;
  storagePaths(scope: DataScope, projectId: string): Promise<string[]>;
  /** Deja el documento en la cola de procesamiento. */
  markQueued(id: string): Promise<DocumentRow>;
  update(id: string, values: DocumentProgress): Promise<void>;
  countProcessing(projectId: string): Promise<number>;
}

export interface ChunkRecord {
  document_id: string;
  project_id: string;
  company_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
}

export interface StoredChunk extends ChunkRecord {
  id: string;
}

export interface EmbeddedChunk<T extends ChunkRecord = ChunkRecord> {
  chunk: T;
  embedding: number[];
  model: string;
}

/** Puerto de salida (Repository): fragmentos indexados para la búsqueda. */
export interface ChunkRepository {
  deleteForDocument(documentId: string): Promise<void>;
  /** Guarda o reemplaza por (documento, índice): idempotente. */
  save(rows: EmbeddedChunk[]): Promise<void>;
  count(projectId: string): Promise<number>;
  /** Fragmentos del proyecto ordenados por id, después de `after`. */
  page(projectId: string, after: string | undefined, limit: number): Promise<StoredChunk[]>;
  saveEmbeddings(rows: EmbeddedChunk<StoredChunk>[]): Promise<void>;
}

export interface DistinctValue {
  campo: string;
  valor: string;
  productos: number;
  contexto: { composiciones?: string[]; tipos_de_tejido?: string[] };
}

/** Puerto de salida (Repository): catálogo estructurado de los CSV / Excel. */
export interface CatalogRepository {
  replaceForDocument(doc: { id: string; companyId: string; projectId: string }, items: CatalogItem[]): Promise<void>;
  distinctValues(projectId: string, fields: string[]): Promise<DistinctValue[]>;
}

export const DOCUMENT_REPOSITORY = Symbol('DOCUMENT_REPOSITORY');
export const CHUNK_REPOSITORY = Symbol('CHUNK_REPOSITORY');
export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
