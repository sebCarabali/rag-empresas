import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import { AppConfig } from '../../../config/app-config';
import { ProjectAccessService } from '../../../application/access/project-access.service';
import {
  EDITOR_ROLES,
  ENRICHMENT_REPOSITORY,
  JOB_QUEUE,
  type EnrichmentRepository,
  type JobQueue,
} from '../../../application/ports';

class RefreshDto {
  /** true: regenera también las que ya existen (vuelve a gastar búsquedas). */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@Controller()
export class EnrichmentsController {
  constructor(
    @Inject(ENRICHMENT_REPOSITORY) private readonly enrichments: EnrichmentRepository,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly access: ProjectAccessService,
    private readonly config: AppConfig,
  ) {}

  /** Descripciones web del proyecto, para revisarlas. */
  @Get('projects/:projectId/enrichments')
  async list(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const items = await this.enrichments.list(scopeOf(user), projectId);
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
    await this.access.require(scopeOf(user), projectId, EDITOR_ROLES, 'Necesitas rol de editor para generar descripciones');
    if (!this.config.webEnrichment) throw new ForbiddenException('El enriquecimiento web está desactivado');

    // Los fallidos se vuelven a intentar; con force se regeneran todos.
    if (!dto.force) await this.enrichments.retryFailed(projectId);
    await this.queue.enqueue({ kind: 'enrich', projectId, force: dto.force === true });
    return { queued: true };
  }
}
