import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../supabase-error';
import { IngestionQueueService } from '../../../infrastructure/queue/ingestion-queue.service';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';

class EvalCaseDto {
  @IsString()
  @Length(1, 1000)
  question: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  must_include: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  must_not_include?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

const CASE_COLUMNS = 'id, project_id, question, must_include, must_not_include, notes, created_at, updated_at';
const RUN_COLUMNS = 'id, project_id, status, total, passed, failed, error, created_at, finished_at';
/** Tope de preguntas por proyecto: cada una es una llamada al modelo al ejecutar. */
const MAX_CASES = 100;

const clean = (list: string[] | undefined) => [...new Set((list ?? []).map((t) => t.trim()).filter(Boolean))];

/** Pruebas automáticas de calidad: preguntas con lo que la respuesta debe (y no debe) decir. */
@Controller('projects/:projectId/evals')
export class EvalsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly queue: IngestionQueueService,
  ) {}

  @Get('cases')
  async cases(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db.from('eval_cases').select(CASE_COLUMNS).eq('project_id', projectId).order('created_at'),
    );
  }

  @Post('cases')
  async createCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: EvalCaseDto,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(
      await db.from('projects').select('id, company_id').eq('id', projectId).single(),
      'Proyecto no encontrado',
    );
    const { count } = await db
      .from('eval_cases')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);
    if ((count ?? 0) >= MAX_CASES) throw new BadRequestException(`Máximo ${MAX_CASES} preguntas de prueba por proyecto`);
    return unwrap(
      await db
        .from('eval_cases')
        .insert({
          company_id: project.company_id,
          project_id: projectId,
          question: dto.question.trim(),
          must_include: clean(dto.must_include),
          must_not_include: clean(dto.must_not_include),
          notes: dto.notes?.trim() || null,
        })
        .select(CASE_COLUMNS)
        .single(),
    );
  }

  @Put('cases/:caseId')
  async updateCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: EvalCaseDto,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db
        .from('eval_cases')
        .update({
          question: dto.question.trim(),
          must_include: clean(dto.must_include),
          must_not_include: clean(dto.must_not_include),
          notes: dto.notes?.trim() || null,
        })
        .eq('id', caseId)
        .eq('project_id', projectId)
        .select(CASE_COLUMNS)
        .single(),
      'Pregunta no encontrada',
    );
  }

  @Delete('cases/:caseId')
  @HttpCode(204)
  async deleteCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    unwrap(
      await db.from('eval_cases').delete().eq('id', caseId).eq('project_id', projectId).select('id').single(),
      'Pregunta no encontrada',
    );
  }

  @Get('runs')
  async runs(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db
        .from('eval_runs')
        .select(RUN_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(20),
    );
  }

  /** Ejecuta todas las preguntas en segundo plano (en la cola). */
  @Post('runs')
  async startRun(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(
      await db.from('projects').select('id, company_id').eq('id', projectId).single(),
      'Proyecto no encontrado',
    );
    const { count } = await db
      .from('eval_cases')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);
    if (!count) throw new BadRequestException('Agrega al menos una pregunta de prueba');

    const { data: active } = await db
      .from('eval_runs')
      .select('id')
      .eq('project_id', projectId)
      .in('status', ['queued', 'running'])
      .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
      .limit(1);
    if (active?.length) throw new BadRequestException('Ya hay una prueba en curso para este proyecto');

    const run = unwrap(
      await db
        .from('eval_runs')
        .insert({ company_id: project.company_id, project_id: projectId, total: count })
        .select(RUN_COLUMNS)
        .single(),
    );
    await this.queue.enqueue({ kind: 'eval', runId: run.id as string });
    return run;
  }

  @Get('runs/:runId')
  async run(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    const run = unwrap(
      await db.from('eval_runs').select(RUN_COLUMNS).eq('id', runId).eq('project_id', projectId).single(),
      'Ejecución no encontrada',
    );
    const results = unwrap(
      await db
        .from('eval_results')
        .select('id, case_id, question, answer, passed, missing, forbidden, model_info, duration_ms, error, created_at')
        .eq('run_id', runId)
        .order('created_at'),
    );
    return { ...run, results };
  }
}
