import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../common/supabase-error';
import { AppConfig } from '../config/app-config';
import { IngestionQueueService } from '../queue/ingestion-queue.service';
import { SupabaseService } from '../supabase/supabase.service';

class RefreshDto {
  /** true: regenera también las que ya existen (vuelve a gastar búsquedas). */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@Controller()
export class EnrichmentsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
    private readonly queue: IngestionQueueService,
  ) {}

  /** Descripciones web del proyecto, para revisarlas. */
  @Get('projects/:projectId/enrichments')
  async list(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    const items = unwrap(
      await db
        .from('catalog_enrichments')
        .select('id, field, value, description, sources, status, error, updated_at')
        .eq('project_id', projectId)
        .order('field')
        .order('value'),
    );
    return { enabled: this.config.webEnrichment, fields: this.config.enrichFields, items };
  }

  /** Genera las que faltan (o todas, con force) en segundo plano. */
  @Post('projects/:projectId/enrichments/refresh')
  @HttpCode(202)
  async refresh(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: RefreshDto,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(
      await db.from('projects').select('id, company_id').eq('id', projectId).single(),
      'Proyecto no encontrado',
    );
    const canEdit = unwrap(
      await db.rpc('has_company_role', { p_company_id: project.company_id, p_roles: ['owner', 'admin', 'editor'] }),
    );
    if (!canEdit) throw new ForbiddenException('Necesitas rol de editor para generar descripciones');
    if (!this.config.webEnrichment) throw new ForbiddenException('El enriquecimiento web está desactivado');

    // Los fallidos se vuelven a intentar; con force se regeneran todos.
    if (!dto.force) {
      await this.supabase.admin
        .from('catalog_enrichments')
        .update({ status: 'pending', error: null })
        .eq('project_id', projectId)
        .eq('status', 'failed');
    }
    await this.queue.enqueue({ kind: 'enrich', projectId, force: dto.force === true });
    return { queued: true };
  }
}
