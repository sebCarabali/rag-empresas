import { BadRequestException, Controller, ForbiddenException, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../supabase-error';
import { AppConfig } from '../../../config/app-config';
import { JOB_QUEUE, type JobQueue } from '../../../application/ports';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';

const WARM_COLUMNS = 'id, status, trigger, total, done, generated, error, created_at, finished_at';

function validTimeZone(tz?: string): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('es', { timeZone: tz });
    return tz;
  } catch {
    throw new BadRequestException('Zona horaria no válida');
  }
}

/** Panel de uso (preguntas, caché, respaldo y gasto estimado) y precalentamiento de la caché. */
@Controller('projects/:projectId')
export class UsageController {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly config: AppConfig,
  ) {}

  private async requireRole(user: AuthUser, projectId: string, roles: string[]) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(
      await db.from('projects').select('id, company_id').eq('id', projectId).single(),
      'Proyecto no encontrado',
    );
    const { data: allowed } = await db.rpc('has_company_role', { p_company_id: project.company_id, p_roles: roles });
    if (!allowed) throw new ForbiddenException('No tienes permiso para esta acción');
    return { db, project };
  }

  @Get('usage')
  async usage(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('days') days?: string,
    @Query('tz') tz?: string,
  ) {
    const { db } = await this.requireRole(user, projectId, ['owner', 'admin']);
    const n = Math.min(Math.max(Number(days) || 30, 1), 365);
    const daily = unwrap(await db.rpc('usage_daily', { p_project_id: projectId, p_days: n, p_tz: validTimeZone(tz) }));
    const { count: cachedAnswers } = await this.supabase.admin
      .from('answer_cache')
      .select('cache_key', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .gt('expires_at', new Date().toISOString());
    return {
      days: n,
      daily,
      cachedAnswers: cachedAnswers ?? 0,
      prices: this.config.prices,
      models: { gemini: this.config.geminiModel, groq: this.config.groqModel },
      semanticThreshold: this.config.semanticCacheMinSimilarity,
      autoWarm: this.config.cacheWarmAuto,
    };
  }

  @Get('cache/warm')
  async warmRuns(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db
        .from('cache_warm_runs')
        .select(WARM_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(10),
    );
  }

  /** Genera de antemano las respuestas a las preguntas sugeridas y frecuentes. */
  @Post('cache/warm')
  async warm(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const { project } = await this.requireRole(user, projectId, ['owner', 'admin', 'editor']);
    if (!this.config.answerCacheTtlHours) throw new BadRequestException('La caché de respuestas está desactivada');
    const admin = this.supabase.admin;
    const { data: active } = await admin
      .from('cache_warm_runs')
      .select('id')
      .eq('project_id', projectId)
      .in('status', ['queued', 'running'])
      .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
      .limit(1);
    if (active?.length) throw new BadRequestException('Ya se está precalentando la caché de este proyecto');
    const run = unwrap(
      await admin
        .from('cache_warm_runs')
        .insert({ company_id: project.company_id, project_id: projectId, trigger: 'manual' })
        .select(WARM_COLUMNS)
        .single(),
    );
    await this.queue.enqueue({ kind: 'warm', runId: run.id as string, projectId });
    return run;
  }
}
