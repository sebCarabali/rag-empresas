import { ConflictException, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../common/supabase-error';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from '../supabase/supabase.service';
import { ReindexService } from './reindex.service';

/** Estado del índice de búsqueda del proyecto y reindexado manual. */
@Controller('projects/:projectId/reindex')
export class ReindexController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly reindex: ReindexService,
    private readonly config: AppConfig,
  ) {}

  /** Cualquier miembro (RLS); si el índice está desactualizado, arranca el reindexado. */
  @Get()
  async status(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    unwrap(await db.from('projects').select('id').eq('id', projectId).single(), 'Proyecto no encontrado');
    await this.reindex.ensureCurrent(projectId);
    const status = await this.reindex.status(projectId);
    return { ...status, reranker: this.config.reranker.enabled ? this.config.reranker.model : null };
  }

  /** Recalcula todos los embeddings del proyecto con el modelo actual (propietario o admin). */
  @Post()
  @HttpCode(202)
  async start(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(
      await db.from('projects').select('id, company_id').eq('id', projectId).single(),
      'Proyecto no encontrado',
    );
    const { data: allowed } = await db.rpc('has_company_role', { p_company_id: project.company_id, p_roles: ['owner', 'admin'] });
    if (!allowed) throw new ForbiddenException('No tienes permiso para esta acción');
    if (!(await this.reindex.start(projectId))) throw new ConflictException('Ya se está reindexando este proyecto');
    return this.reindex.status(projectId);
  }
}
