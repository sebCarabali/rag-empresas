import { ConflictException, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import { AppConfig } from '../../../config/app-config';
import { ReindexService } from '../../../application/embeddings/reindex.service';
import { ProjectAccessService } from '../../../application/access/project-access.service';
import { ADMIN_ROLES, PROJECT_REPOSITORY, type ProjectRepository } from '../../../application/ports';

/** Estado del índice de búsqueda del proyecto y reindexado manual. */
@Controller('projects/:projectId/reindex')
export class ReindexController {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    private readonly access: ProjectAccessService,
    private readonly reindex: ReindexService,
    private readonly config: AppConfig,
  ) {}

  /** Cualquier miembro; si el índice está desactualizado, arranca el reindexado. */
  @Get()
  async status(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    await this.projects.ref(scopeOf(user), projectId);
    await this.reindex.ensureCurrent(projectId);
    const status = await this.reindex.status(projectId);
    return { ...status, reranker: this.config.reranker.enabled ? this.config.reranker.model : null };
  }

  /** Recalcula todos los embeddings del proyecto con el modelo actual (propietario o admin). */
  @Post()
  @HttpCode(202)
  async start(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    await this.access.require(scopeOf(user), projectId, ADMIN_ROLES);
    if (!(await this.reindex.start(projectId))) throw new ConflictException('Ya se está reindexando este proyecto');
    return this.reindex.status(projectId);
  }
}
