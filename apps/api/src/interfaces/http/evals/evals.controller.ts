import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import {
  EVAL_REPOSITORY,
  JOB_QUEUE,
  PROJECT_REPOSITORY,
  type EvalCaseInput,
  type EvalRepository,
  type JobQueue,
  type ProjectRepository,
} from '../../../application/ports';

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

/** Tope de preguntas por proyecto: cada una es una llamada al modelo al ejecutar. */
const MAX_CASES = 100;
/** Una ejecución "en curso" más antigua que esto se considera abandonada. */
const ACTIVE_WINDOW_MS = 30 * 60_000;

const clean = (list: string[] | undefined) => [...new Set((list ?? []).map((t) => t.trim()).filter(Boolean))];

function toInput(dto: EvalCaseDto): EvalCaseInput {
  return {
    question: dto.question.trim(),
    must_include: clean(dto.must_include),
    must_not_include: clean(dto.must_not_include),
    notes: dto.notes?.trim() || null,
  };
}

/** Pruebas automáticas de calidad: preguntas con lo que la respuesta debe (y no debe) decir. */
@Controller('projects/:projectId/evals')
export class EvalsController {
  constructor(
    @Inject(EVAL_REPOSITORY) private readonly evals: EvalRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  @Get('cases')
  cases(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.evals.listCases(scopeOf(user), projectId);
  }

  @Post('cases')
  async createCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: EvalCaseDto,
  ) {
    const scope = scopeOf(user);
    const project = await this.projects.ref(scope, projectId);
    if ((await this.evals.countCases(scope, projectId)) >= MAX_CASES) {
      throw new BadRequestException(`Máximo ${MAX_CASES} preguntas de prueba por proyecto`);
    }
    return this.evals.createCase(scope, project, toInput(dto));
  }

  @Put('cases/:caseId')
  updateCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: EvalCaseDto,
  ) {
    return this.evals.updateCase(scopeOf(user), projectId, caseId, toInput(dto));
  }

  @Delete('cases/:caseId')
  @HttpCode(204)
  async deleteCase(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ) {
    await this.evals.deleteCase(scopeOf(user), projectId, caseId);
  }

  @Get('runs')
  runs(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.evals.listRuns(scopeOf(user), projectId, 20);
  }

  /** Ejecuta todas las preguntas en segundo plano (en la cola). */
  @Post('runs')
  async startRun(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const scope = scopeOf(user);
    const project = await this.projects.ref(scope, projectId);
    const count = await this.evals.countCases(scope, projectId);
    if (!count) throw new BadRequestException('Agrega al menos una pregunta de prueba');
    if (await this.evals.hasActiveRun(scope, projectId, new Date(Date.now() - ACTIVE_WINDOW_MS))) {
      throw new BadRequestException('Ya hay una prueba en curso para este proyecto');
    }
    const run = await this.evals.createRun(scope, project, count);
    await this.queue.enqueue({ kind: 'eval', runId: run.id });
    return run;
  }

  @Get('runs/:runId')
  run(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.evals.getRun(scopeOf(user), projectId, runId);
  }
}
