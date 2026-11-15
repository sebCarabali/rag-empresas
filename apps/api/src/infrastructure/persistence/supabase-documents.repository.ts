import { Injectable, Logger } from '@nestjs/common';
import type { CatalogItem } from '../../domain/ingestion/csv-catalog';
import type {
  CatalogRepository,
  ChunkRecord,
  ChunkRepository,
  DataScope,
  DistinctValue,
  DocumentFile,
  DocumentProgress,
  DocumentRepository,
  DocumentRow,
  EmbeddedChunk,
  StoredChunk,
} from '../../application/ports';
import { SupabaseService } from '../supabase/supabase.service';
import { toPgVector } from './pg-vector';
import { check, unwrap } from './supabase-result';

const DOCUMENT_COLUMNS =
  'id, company_id, project_id, name, mime_type, size_bytes, status, error, chunk_count, created_at, updated_at, ' +
  'progress_stage, progress_done, progress_total, processing_started_at';
const CATALOG_INSERT_BATCH = 500;

/** Adaptador (Repository) sobre la tabla documents. */
@Injectable()
export class SupabaseDocumentRepository implements DocumentRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async list(scope: DataScope, projectId: string): Promise<DocumentRow[]> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('documents')
        .select(DOCUMENT_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
    ) as unknown as DocumentRow[];
  }

  async create(
    scope: DataScope,
    input: { id: string; companyId: string; projectId: string; name: string; storagePath: string; mimeType: string; sizeBytes: number },
  ): Promise<DocumentRow> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('documents')
        .insert({
          id: input.id,
          company_id: input.companyId,
          project_id: input.projectId,
          name: input.name,
          storage_path: input.storagePath,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          status: 'uploading',
        })
        .select(DOCUMENT_COLUMNS)
        .single(),
    ) as unknown as DocumentRow;
  }

  async find(scope: DataScope, id: string): Promise<DocumentFile | null> {
    const { data, error } = await this.supabase
      .client(scope)
      .from('documents')
      .select('id, company_id, project_id, name, storage_path, mime_type, status')
      .eq('id', id)
      .maybeSingle();
    check(error);
    return (data as DocumentFile | null) ?? null;
  }

  async delete(scope: DataScope, id: string): Promise<{ storagePath: string }> {
    const row = unwrap(
      await this.supabase.client(scope).from('documents').delete().eq('id', id).select('storage_path').single(),
      'Documento no encontrado o sin permiso',
    );
    return { storagePath: row.storage_path as string };
  }

  async storagePaths(scope: DataScope, projectId: string): Promise<string[]> {
    const rows = unwrap(await this.supabase.client(scope).from('documents').select('storage_path').eq('project_id', projectId));
    return rows.map((d) => d.storage_path as string);
  }

  async markQueued(id: string): Promise<DocumentRow> {
    return unwrap(
      await this.supabase.admin
        .from('documents')
        .update({ status: 'pending', error: null, progress_stage: 'queued', progress_done: 0, progress_total: 0 })
        .eq('id', id)
        .select(DOCUMENT_COLUMNS)
        .single(),
      'Documento no encontrado',
    ) as unknown as DocumentRow;
  }

  async update(id: string, values: DocumentProgress): Promise<void> {
    check((await this.supabase.admin.from('documents').update(values).eq('id', id)).error);
  }

  async countProcessing(projectId: string): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .in('status', ['pending', 'processing']);
    check(error);
    return count ?? 0;
  }
}

function chunkRow<T extends ChunkRecord>({ chunk, embedding, model }: EmbeddedChunk<T>) {
  return { ...chunk, embedding: toPgVector(embedding), embedding_model: model };
}

/** Adaptador (Repository) sobre document_chunks. */
@Injectable()
export class SupabaseChunkRepository implements ChunkRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async deleteForDocument(documentId: string): Promise<void> {
    check((await this.supabase.admin.from('document_chunks').delete().eq('document_id', documentId)).error);
  }

  async save(rows: EmbeddedChunk[]): Promise<void> {
    const { error } = await this.supabase.admin
      .from('document_chunks')
      .upsert(rows.map(chunkRow), { onConflict: 'document_id,chunk_index' });
    check(error);
  }

  async count(projectId: string): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);
    check(error);
    return count ?? 0;
  }

  async page(projectId: string, after: string | undefined, limit: number): Promise<StoredChunk[]> {
    let query = this.supabase.admin
      .from('document_chunks')
      .select('id, document_id, project_id, company_id, chunk_index, content, metadata')
      .eq('project_id', projectId)
      .order('id')
      .limit(limit);
    if (after) query = query.gt('id', after);
    const { data, error } = await query;
    check(error);
    return (data ?? []) as StoredChunk[];
  }

  async saveEmbeddings(rows: EmbeddedChunk<StoredChunk>[]): Promise<void> {
    const { error } = await this.supabase.admin.from('document_chunks').upsert(rows.map(chunkRow), { onConflict: 'id' });
    check(error);
  }
}

/** Adaptador (Repository) sobre catalog_items. */
@Injectable()
export class SupabaseCatalogRepository implements CatalogRepository {
  private readonly logger = new Logger(SupabaseCatalogRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  async replaceForDocument(doc: { id: string; companyId: string; projectId: string }, items: CatalogItem[]): Promise<void> {
    const db = this.supabase.admin;
    const { error: delError } = await db.from('catalog_items').delete().eq('document_id', doc.id);
    if (delError) throw new Error(`Catálogo: ${delError.message}`);

    for (let i = 0; i < items.length; i += CATALOG_INSERT_BATCH) {
      const rows = items.slice(i, i + CATALOG_INSERT_BATCH).map((item) => ({
        company_id: doc.companyId,
        project_id: doc.projectId,
        document_id: doc.id,
        row_number: item.row,
        name: item.name,
        code: item.code,
        attributes: item.attributes,
        numbers: item.numbers,
        image_url: item.image,
      }));
      const { error } = await db.from('catalog_items').insert(rows);
      if (error) throw new Error(`Catálogo: ${error.message}`);
    }
    if (items.length > 0) this.logger.log(`Documento ${doc.id}: ${items.length} productos en el catálogo`);
  }

  async distinctValues(projectId: string, fields: string[]): Promise<DistinctValue[]> {
    const { data, error } = await this.supabase.admin.rpc('catalog_distinct_values', { p_project_id: projectId, p_fields: fields });
    if (error) throw new Error(`catalog_distinct_values: ${error.message}`);
    return (data ?? []) as DistinctValue[];
  }
}
