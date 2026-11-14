import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  InternalServerErrorException,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../common/supabase-error';
import { AppConfig } from '../config/app-config';
import { SUPPORTED_MIME_TYPES } from '../ingestion/text-extractor';
import { IngestionQueueService } from '../queue/ingestion-queue.service';
import { SupabaseService } from '../supabase/supabase.service';

class CreateDocumentDto {
  @IsString()
  @Length(1, 255)
  fileName: string;

  @IsIn(Object.keys(SUPPORTED_MIME_TYPES), {
    message: `Tipo no soportado. Permitidos: ${Object.values(SUPPORTED_MIME_TYPES).join(', ')}`,
  })
  mimeType: string;

  @IsInt()
  @Min(1)
  @Max(50 * 1024 * 1024)
  sizeBytes: number;
}

const DOCUMENT_COLUMNS =
  'id, company_id, project_id, name, mime_type, size_bytes, status, error, chunk_count, created_at, updated_at';

/** Deja solo caracteres seguros para la ruta en Storage. */
function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120);
  return cleaned || 'archivo';
}

@Controller()
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
    private readonly queue: IngestionQueueService,
  ) {}

  @Get('projects/:projectId/documents')
  async list(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db
        .from('documents')
        .select(DOCUMENT_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
    );
  }

  /**
   * Paso 1 de la subida: registra el documento y devuelve una URL firmada para
   * que el navegador suba el archivo directo a Supabase Storage (sin pasar por
   * la función, que tiene límite de tamaño de petición).
   */
  @Post('projects/:projectId/documents')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(
      await db.from('projects').select('id, company_id').eq('id', projectId).single(),
      'Proyecto no encontrado',
    );

    const id = randomUUID();
    const storagePath = `${project.company_id}/${project.id}/${id}/${safeFileName(dto.fileName)}`;

    const document = unwrap(
      await db
        .from('documents')
        .insert({
          id,
          company_id: project.company_id,
          project_id: project.id,
          name: dto.fileName,
          storage_path: storagePath,
          mime_type: dto.mimeType,
          size_bytes: dto.sizeBytes,
          status: 'uploading',
        })
        .select(DOCUMENT_COLUMNS)
        .single(),
    );

    // Con el cliente del usuario: las políticas de Storage vuelven a validar el rol.
    const { data: upload, error } = await db.storage
      .from(this.config.storageBucket)
      .createSignedUploadUrl(storagePath);
    if (error || !upload) {
      await db.from('documents').delete().eq('id', id);
      throw new ForbiddenException(`No se pudo preparar la subida: ${error?.message}`);
    }

    return { document, upload: { path: upload.path, token: upload.token, signedUrl: upload.signedUrl } };
  }

  /** Paso 2: el archivo ya está en Storage; se encola para procesarlo. También sirve para reprocesar. */
  @Post('documents/:documentId/process')
  async process(@CurrentUser() user: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string) {
    const db = this.supabase.forUser(user.accessToken);
    const doc = unwrap(
      await db.from('documents').select('id, company_id, storage_path, status').eq('id', documentId).single(),
      'Documento no encontrado',
    );

    const canEdit = unwrap(
      await db.rpc('has_company_role', {
        p_company_id: doc.company_id,
        p_roles: ['owner', 'admin', 'editor'],
      }),
    );
    if (!canEdit) throw new ForbiddenException('Necesitas rol de editor para procesar documentos');

    if (doc.status === 'pending' || doc.status === 'processing') {
      throw new ConflictException('El documento ya se está procesando');
    }

    // Verificar que el archivo realmente se subió (list es más fiable que exists/HEAD).
    const slash = doc.storage_path.lastIndexOf('/');
    const folder = doc.storage_path.slice(0, slash);
    const fileName = doc.storage_path.slice(slash + 1);
    const { data: files, error: listError } = await this.supabase.admin.storage
      .from(this.config.storageBucket)
      .list(folder, { search: fileName, limit: 10 });
    if (listError) {
      this.logger.error(`Storage list falló para ${doc.storage_path}: ${listError.message}`);
      throw new InternalServerErrorException('No se pudo verificar el archivo en Storage');
    }
    if (!files?.some((f) => f.name === fileName)) {
      this.logger.warn(`Archivo no encontrado en Storage: ${doc.storage_path}`);
      throw new BadRequestException('El archivo no se encuentra en Storage; súbelo de nuevo');
    }

    const updated = unwrap(
      await this.supabase.admin
        .from('documents')
        .update({ status: 'pending', error: null })
        .eq('id', doc.id)
        .select(DOCUMENT_COLUMNS)
        .single(),
    );

    await this.queue.enqueue({ documentId: doc.id, startChunk: 0 });
    return updated;
  }

  @Delete('documents/:documentId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string) {
    const db = this.supabase.forUser(user.accessToken);
    // RLS solo permite borrar a editores o superiores; los chunks caen en cascada.
    const deleted = unwrap(
      await db.from('documents').delete().eq('id', documentId).select('storage_path').single(),
      'Documento no encontrado o sin permiso',
    );
    const { error } = await this.supabase.admin.storage
      .from(this.config.storageBucket)
      .remove([deleted.storage_path, `${deleted.storage_path}.ocr.json`]);
    if (error) this.logger.error(`No se pudo borrar ${deleted.storage_path}: ${error.message}`);
  }
}
