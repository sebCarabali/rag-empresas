import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../domain/errors';
import { ProjectAccessService } from '../access/project-access.service';
import {
  DOCUMENT_REPOSITORY,
  EDITOR_ROLES,
  FILE_STORAGE,
  JOB_QUEUE,
  PROJECT_REPOSITORY,
  type DataScope,
  type DocumentRepository,
  type DocumentRow,
  type FileStorage,
  type JobQueue,
  type ProjectRepository,
  type SignedUpload,
} from '../ports';

/** Deja solo caracteres seguros para la ruta del archivo. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120);
  return cleaned || 'archivo';
}

/** Ruta de la transcripción OCR guardada junto al archivo. */
export const ocrCachePath = (storagePath: string) => `${storagePath}.ocr.json`;

/** Casos de uso de los documentos: subir, encolar el procesamiento y borrar. */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepository,
    @Inject(FILE_STORAGE) private readonly files: FileStorage,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    private readonly access: ProjectAccessService,
  ) {}

  /**
   * Paso 1 de la subida: registra el documento y devuelve una URL firmada para
   * que el navegador suba el archivo directo al almacenamiento (sin pasar por
   * la función, que tiene límite de tamaño de petición).
   */
  async create(
    scope: DataScope,
    projectId: string,
    file: { fileName: string; mimeType: string; sizeBytes: number },
  ): Promise<{ document: DocumentRow; upload: SignedUpload }> {
    const project = await this.projects.ref(scope, projectId);
    const id = randomUUID();
    const storagePath = `${project.companyId}/${project.id}/${id}/${safeFileName(file.fileName)}`;
    const document = await this.documents.create(scope, {
      id,
      companyId: project.companyId,
      projectId: project.id,
      name: file.fileName,
      storagePath,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    });
    try {
      // Con los permisos del usuario: el almacenamiento vuelve a validar su rol.
      return { document, upload: await this.files.createSignedUpload(scope, storagePath) };
    } catch (err) {
      await this.documents.delete(scope, id).catch(() => undefined);
      throw err;
    }
  }

  /** Paso 2: el archivo ya está subido; se encola para procesarlo. También sirve para reprocesar. */
  async process(scope: DataScope, documentId: string): Promise<DocumentRow> {
    const doc = await this.documents.find(scope, documentId);
    if (!doc) throw new NotFoundError('Documento no encontrado');
    if (!(await this.access.hasRole(scope, doc.company_id, EDITOR_ROLES))) {
      throw new ForbiddenError('Necesitas rol de editor para procesar documentos');
    }
    if (doc.status === 'pending' || doc.status === 'processing') {
      throw new ConflictError('El documento ya se está procesando');
    }
    if (!(await this.files.exists(doc.storage_path))) {
      this.logger.warn(`Archivo no encontrado en Storage: ${doc.storage_path}`);
      throw new InvalidInputError('El archivo no se encuentra en Storage; súbelo de nuevo');
    }
    const updated = await this.documents.markQueued(doc.id);
    await this.queue.enqueue({ documentId: doc.id, startChunk: 0 });
    return updated;
  }

  /** Borra el documento (los permisos los exige la base; los fragmentos caen en cascada) y su archivo. */
  async remove(scope: DataScope, documentId: string): Promise<void> {
    const { storagePath } = await this.documents.delete(scope, documentId);
    await this.files.remove([storagePath, ocrCachePath(storagePath)]);
  }
}
