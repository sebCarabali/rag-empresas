import { BadRequestException, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import { AppConfig } from '../../../config/app-config';
import { ProjectAccessService } from '../../../application/access/project-access.service';
import {
  ADMIN_ROLES,
  ANSWER_CACHE,
  EDITOR_ROLES,
  JOB_QUEUE,
  USAGE_STATS,
  WARM_RUN_REPOSITORY,
  type AnswerCache,
  type JobQueue,
  type UsageStats,
  type WarmRunRepository,
} from '../../../application/ports';

/** Un precalentamiento "en curso" más antiguo que esto se considera abandonado. */
const ACTIVE_WINDOW_MS = 30 * 60_000;

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
    @Inject(USAGE_STATS) private readonly stats: UsageStats,
    @Inject(ANSWER_CACHE) private readonly cache: AnswerCache,
    @Inject(WARM_RUN_REPOSITORY) private readonly warmRuns: WarmRunRepository,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly access: ProjectAccessService,
    private readonly config: AppConfig,
  ) {}

  @Get('usage')
  async usage(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('days') days?: string,
    @Query('tz') tz?: string,
  ) {
    const scope = scopeOf(user);
    await this.access.require(scope, projectId, ADMIN_ROLES);
    const n = Math.min(Math.max(Number(days) || 30, 1), 365);
    return {
      days: n,
      daily: await this.stats.daily(scope, projectId, n, validTimeZone(tz)),
      cachedAnswers: await this.cache.count(projectId),
      prices: this.config.prices,
      models: { gemini: this.config.geminiModel, groq: this.config.groqModel },
      semanticThreshold: this.config.semanticCacheMinSimilarity,
      autoWarm: this.config.cacheWarmAuto,
    };
  }

  @Get('cache/warm')
  warmRunList(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.warmRuns.list(scopeOf(user), projectId, 10);
  }

  /** Genera de antemano las respuestas a las preguntas sugeridas y frecuentes. */
  @Post('cache/warm')
  async warm(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const project = await this.access.require(scopeOf(user), projectId, EDITOR_ROLES);
    if (!this.config.answerCacheTtlHours) throw new BadRequestException('La caché de respuestas está desactivada');
    if (await this.warmRuns.hasActive(projectId, new Date(Date.now() - ACTIVE_WINDOW_MS))) {
      throw new BadRequestException('Ya se está precalentando la caché de este proyecto');
    }
    const run = await this.warmRuns.create(project, 'manual');
    await this.queue.enqueue({ kind: 'warm', runId: run.id, projectId });
    return run;
  }
}
