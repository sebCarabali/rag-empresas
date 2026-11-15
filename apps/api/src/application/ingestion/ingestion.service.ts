import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { toPgVector } from '../../infrastructure/persistence/pg-vector';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { ModelSettingsService } from '../models/model-settings.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { chunkSections, type Chunk } from '../../domain/ingestion/chunker';
import { csvToCatalogItems, csvToChunks, type CatalogItem } from '../../domain/ingestion/csv-catalog';
import { TABULAR_MIME_TYPES, UnsupportedFileError, XLSX_MIME, type TextSection } from '../../domain/ingestion/documents';
import {
  DOCUMENT_READER,
  PROVIDER_KEY_READER,
  TEXT_RECOGNIZER,
  type DocumentReader,
  type ProviderKeyReader,
  type TextRecognizer,
} from '../ports';

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
  /** Proyecto del documento terminado (para precalentar la caché). */
  projectId?: string;
}

/** Errores que no se arreglan reintentando: el documento se marca como fallido de inmediato. */
export class PermanentIngestionError extends Error {}

/** Error transitorio del OCR: el trabajo se reintenta. */
export class OcrFailedError extends Error {}

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
    private readonly models: ModelSettingsService,
    private readonly config: AppConfig,
    @Inject(TEXT_RECOGNIZER) private readonly ocr: TextRecognizer,
    @Inject(DOCUMENT_READER) private readonly reader: DocumentReader,
    @Inject(PROVIDER_KEY_READER) private readonly keys: ProviderKeyReader,
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
      await this.updateDocument(doc.id, {
        status: 'processing',
        error: null,
        chunk_count: 0,
        progress_stage: 'reading',
        progress_done: 0,
        progress_total: 0,
        processing_started_at: new Date().toISOString(),
      });
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
    let catalogItems: CatalogItem[] = [];
    try {
      if (doc.mime_type === 'text/csv') {
        // Tablas: un fragmento por producto + catálogo estructurado.
        chunks = csvToChunks(buffer);
        catalogItems = csvToCatalogItems(buffer);
      } else if (doc.mime_type === XLSX_MIME) {
        ({ chunks, items: catalogItems } = await this.reader.readSpreadsheet(buffer));
      } else {
        // OCR con la clave de Gemini de la empresa (PDF escaneados e imágenes).
        const ocr = (b: Buffer, mime: string) => this.cachedOcr(doc, b, mime);
        chunks = chunkSections(await this.reader.extractText(buffer, doc.mime_type, ocr));
      }
    } catch (err) {
      if (err instanceof UnsupportedFileError) throw new PermanentIngestionError(err.message);
      // Un fallo de OCR (Gemini caído, cuota) se reintenta desde la cola.
      if (err instanceof OcrFailedError) throw err;
      throw new PermanentIngestionError(`No se pudo leer el archivo: ${(err as Error).message}`);
    }

    // Catálogo estructurado (filtros exactos y conteos): se reemplaza al iniciar el documento.
    if (job.startChunk === 0 && TABULAR_MIME_TYPES.has(doc.mime_type)) {
      await this.updateDocument(doc.id, { progress_stage: 'catalog', progress_total: chunks.length });
      await this.replaceCatalog(doc, catalogItems);
    }

    if (chunks.length === 0) {
      throw new PermanentIngestionError(
        'No se encontró texto en el archivo (ni con OCR). Revisa que no esté vacío o protegido.',
      );
    }

    await this.updateDocument(doc.id, {
      progress_stage: 'embedding',
      progress_done: job.startChunk,
      progress_total: chunks.length,
    });
    let lastProgress = Date.now();
    // Modelo de embeddings elegido para el proyecto (las claves de API son de la empresa).
    const embed = { model: await this.models.embeddingModel(doc.project_id), projectId: doc.project_id };

    for (let i = job.startChunk; i < chunks.length; i += EMBED_BATCH_SIZE) {
      // Avance visible en la app, como mucho cada 1,5 s para no saturar la base.
      if (i > job.startChunk && Date.now() - lastProgress > 1500) {
        lastProgress = Date.now();
        await this.updateDocument(doc.id, { progress_done: i }).catch(() => undefined);
      }
      if (i > job.startChunk && Date.now() - started > TIME_BUDGET_MS) {
        await this.updateDocument(doc.id, { chunk_count: i, progress_done: i });
        this.logger.log(`Documento ${doc.id}: ${i}/${chunks.length} chunks; continúa en otro lote`);
        return { next: { documentId: doc.id, startChunk: i } };
      }

      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await this.embeddings.embedPassages(batch.map((c) => c.content), embed);

      const rows = batch.map((chunk, j) => ({
        document_id: doc.id,
        project_id: doc.project_id,
        company_id: doc.company_id,
        chunk_index: i + j,
        content: chunk.content,
        metadata: { ...chunk.metadata, document_name: doc.name },
        embedding: toPgVector(vectors[j]),
        embedding_model: embed.model,
      }));

      const { error: upsertError } = await db
        .from('document_chunks')
        .upsert(rows, { onConflict: 'document_id,chunk_index' });
      if (upsertError) throw new Error(upsertError.message);
    }

    await this.updateDocument(doc.id, {
      status: 'ready',
      chunk_count: chunks.length,
      error: null,
      progress_stage: 'done',
      progress_done: chunks.length,
      progress_total: chunks.length,
    });
    this.logger.log(`Documento ${doc.id} listo: ${chunks.length} chunks en ${Date.now() - started} ms`);
    return TABULAR_MIME_TYPES.has(doc.mime_type)
      ? { enrichProjectId: doc.project_id, projectId: doc.project_id }
      : { projectId: doc.project_id };
  }

  /**
   * OCR con la clave de Gemini de la empresa. La transcripción se guarda junto al archivo
   * para que los lotes siguientes (y los reprocesos) no vuelvan a pagar el OCR.
   */
  private async cachedOcr(
    doc: { id: string; company_id: string; project_id: string; storage_path: string },
    buffer: Buffer,
    mimeType: string,
  ): Promise<TextSection[]> {
    const storage = this.supabase.admin.storage.from(this.config.storageBucket);
    const cachePath = `${doc.storage_path}.ocr.json`;
    const { data: cached } = await storage.download(cachePath);
    if (cached) {
      try {
        return JSON.parse(await cached.text()) as TextSection[];
      } catch {
        // caché corrupta: se vuelve a transcribir
      }
    }
    let sections: TextSection[];
    await this.updateDocument(doc.id, { progress_stage: 'ocr' }).catch(() => undefined);
    // El OCR usa Gemini con la clave del asistente: sin ella no se puede leer el escaneo.
    const geminiKey = await this.keys.getKey(doc.project_id, 'gemini');
    if (!geminiKey) {
      throw new PermanentIngestionError(
        'Para leer PDF escaneados o imágenes, guarda la clave de Gemini del asistente (Asistente y widget → Modelos) y reprocesa el documento.',
      );
    }
    try {
      sections = await this.ocr.transcribe(buffer, mimeType, geminiKey, {
        companyId: doc.company_id,
        projectId: doc.project_id,
      });
    } catch (err) {
      throw new OcrFailedError(`OCR con Gemini falló: ${(err as Error).message}`);
    }
    await storage
      .upload(cachePath, JSON.stringify(sections), { contentType: 'application/json', upsert: true })
      .catch(() => undefined);
    return sections;
  }

  private async replaceCatalog(
    doc: { id: string; company_id: string; project_id: string },
    items: CatalogItem[],
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
