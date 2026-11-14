import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { EmbeddingsService, toPgVector } from '../embeddings/embeddings.service';
import { SupabaseService } from '../supabase/supabase.service';
import { chunkSections, type Chunk } from './chunker';
import { csvToCatalogItems, csvToChunks } from './csv-catalog';
import { extractText, UnsupportedFileError } from './text-extractor';

export interface IngestionJob {
  documentId: string;
  /** Índice del primer chunk a procesar en esta invocación (procesamiento por lotes). */
  startChunk: number;
}

export interface IngestionResult {
  /** Si el documento no terminó dentro del presupuesto de tiempo, el siguiente lote. */
  next?: IngestionJob;
  /** Proyecto cuyo catálogo cambió: hay que generar descripciones web nuevas. */
  enrichProjectId?: string;
}

/** Errores que no se arreglan reintentando: el documento se marca como fallido de inmediato. */
export class PermanentIngestionError extends Error {}

const EMBED_BATCH_SIZE = 16;
const CATALOG_INSERT_BATCH = 500;
/** Margen bajo el límite de 300 s de Vercel (Hobby) para guardar y encolar el siguiente lote. */
const TIME_BUDGET_MS = 200_000;

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly embeddings: EmbeddingsService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Procesa un documento: descarga → extrae texto → divide en chunks →
   * genera embeddings → guarda. Es idempotente (upsert por document_id +
   * chunk_index), porque la cola puede entregar el mismo mensaje más de una vez.
   */
  async process(job: IngestionJob): Promise<IngestionResult> {
    const started = Date.now();
    const db = this.supabase.admin;

    const { data: doc, error } = await db
      .from('documents')
      .select('id, company_id, project_id, name, storage_path, mime_type, status')
      .eq('id', job.documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) {
      this.logger.warn(`Documento ${job.documentId} ya no existe; se descarta el mensaje`);
      return {};
    }

    if (job.startChunk === 0) {
      await this.updateDocument(doc.id, { status: 'processing', error: null, chunk_count: 0 });
      // Reprocesamiento: borrar chunks anteriores.
      const { error: delError } = await db.from('document_chunks').delete().eq('document_id', doc.id);
      if (delError) throw new Error(delError.message);
    }

    const { data: file, error: dlError } = await db.storage
      .from(this.config.storageBucket)
      .download(doc.storage_path);
    if (dlError || !file) {
      throw new PermanentIngestionError(`No se pudo descargar el archivo: ${dlError?.message ?? 'vacío'}`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let chunks: Chunk[];
    try {
      // Los CSV se procesan por filas (un fragmento por producto); el resto, por texto.
      chunks =
        doc.mime_type === 'text/csv'
          ? csvToChunks(buffer)
          : chunkSections(await extractText(buffer, doc.mime_type));
    } catch (err) {
      if (err instanceof UnsupportedFileError) throw new PermanentIngestionError(err.message);
      throw new PermanentIngestionError(`No se pudo leer el archivo: ${(err as Error).message}`);
    }

    // Catálogo estructurado (filtros exactos y conteos): se reemplaza al iniciar el documento.
    if (job.startChunk === 0 && doc.mime_type === 'text/csv') {
      await this.replaceCatalog(doc, csvToCatalogItems(buffer));
    }

    if (chunks.length === 0) {
      throw new PermanentIngestionError(
        'No se encontró texto en el archivo. Si es un PDF escaneado, necesita OCR.',
      );
    }

    for (let i = job.startChunk; i < chunks.length; i += EMBED_BATCH_SIZE) {
      if (i > job.startChunk && Date.now() - started > TIME_BUDGET_MS) {
        await this.updateDocument(doc.id, { chunk_count: i });
        this.logger.log(`Documento ${doc.id}: ${i}/${chunks.length} chunks; continúa en otro lote`);
        return { next: { documentId: doc.id, startChunk: i } };
      }

      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await this.embeddings.embedPassages(batch.map((c) => c.content));

      const rows = batch.map((chunk, j) => ({
        document_id: doc.id,
        project_id: doc.project_id,
        company_id: doc.company_id,
        chunk_index: i + j,
        content: chunk.content,
        metadata: { ...chunk.metadata, document_name: doc.name },
        embedding: toPgVector(vectors[j]),
      }));

      const { error: upsertError } = await db
        .from('document_chunks')
        .upsert(rows, { onConflict: 'document_id,chunk_index' });
      if (upsertError) throw new Error(upsertError.message);
    }

    await this.updateDocument(doc.id, { status: 'ready', chunk_count: chunks.length, error: null });
    this.logger.log(`Documento ${doc.id} listo: ${chunks.length} chunks en ${Date.now() - started} ms`);
    return doc.mime_type === 'text/csv' ? { enrichProjectId: doc.project_id } : {};
  }

  private async replaceCatalog(
    doc: { id: string; company_id: string; project_id: string },
    items: ReturnType<typeof csvToCatalogItems>,
  ): Promise<void> {
    const db = this.supabase.admin;
    const { error: delError } = await db.from('catalog_items').delete().eq('document_id', doc.id);
    if (delError) throw new Error(`Catálogo: ${delError.message}`);

    for (let i = 0; i < items.length; i += CATALOG_INSERT_BATCH) {
      const rows = items.slice(i, i + CATALOG_INSERT_BATCH).map((item) => ({
        company_id: doc.company_id,
        project_id: doc.project_id,
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

  async markFailed(documentId: string, message: string): Promise<void> {
    await this.updateDocument(documentId, { status: 'failed', error: message.slice(0, 1000) });
  }

  private async updateDocument(id: string, values: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.admin.from('documents').update(values).eq('id', id);
    if (error) throw new Error(error.message);
  }
}
