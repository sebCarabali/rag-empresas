import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import { SUPPORTED_MIME_TYPES } from '../../../domain/ingestion/documents';
import { DOCUMENT_REPOSITORY, type DocumentRepository } from '../../../application/ports';
import { DocumentsService } from '../../../application/documents/documents.service';

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

@Controller()
export class DocumentsController {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepository,
    private readonly service: DocumentsService,
  ) {}

  @Get('projects/:projectId/documents')
  list(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.documents.list(scopeOf(user), projectId);
  }

  /** Paso 1 de la subida: registra el documento y devuelve una URL firmada para subir el archivo. */
  @Post('projects/:projectId/documents')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.service.create(scopeOf(user), projectId, dto);
  }

  /** Paso 2: el archivo ya está subido; se encola para procesarlo. También sirve para reprocesar. */
  @Post('documents/:documentId/process')
  process(@CurrentUser() user: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.service.process(scopeOf(user), documentId);
  }

  @Delete('documents/:documentId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string) {
    await this.service.remove(scopeOf(user), documentId);
  }
}
