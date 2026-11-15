import { Injectable } from '@nestjs/common';
import type {
  DataScope,
  EvalCase,
  EvalCaseInput,
  EvalRepository,
  EvalResultInput,
  EvalRun,
  EvalRunStatus,
  ProjectRef,
} from '../../application/ports';
import { SupabaseService } from '../supabase/supabase.service';
import { check, unwrap } from './supabase-result';

const CASE_COLUMNS = 'id, project_id, question, must_include, must_not_include, notes, created_at, updated_at';
const RUN_COLUMNS = 'id, project_id, status, total, passed, failed, error, created_at, finished_at';
const RESULT_COLUMNS = 'id, case_id, question, answer, passed, missing, forbidden, model_info, duration_ms, error, created_at';

/** Adaptador (Repository) sobre eval_cases, eval_runs y eval_results. */
@Injectable()
export class SupabaseEvalRepository implements EvalRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async listCases(scope: DataScope, projectId: string): Promise<EvalCase[]> {
    return unwrap(
      await this.supabase.client(scope).from('eval_cases').select(CASE_COLUMNS).eq('project_id', projectId).order('created_at'),
    ) as EvalCase[];
  }

  async countCases(scope: DataScope, projectId: string): Promise<number> {
    const { count, error } = await this.supabase
      .client(scope)
      .from('eval_cases')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);
    check(error);
    return count ?? 0;
  }

  async createCase(scope: DataScope, project: ProjectRef, input: EvalCaseInput): Promise<EvalCase> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('eval_cases')
        .insert({ company_id: project.companyId, project_id: project.id, ...input })
        .select(CASE_COLUMNS)
        .single(),
    ) as EvalCase;
  }

  async updateCase(scope: DataScope, projectId: string, caseId: string, input: EvalCaseInput): Promise<EvalCase> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('eval_cases')
        .update(input)
        .eq('id', caseId)
        .eq('project_id', projectId)
        .select(CASE_COLUMNS)
        .single(),
      'Pregunta no encontrada',
    ) as EvalCase;
  }

  async deleteCase(scope: DataScope, projectId: string, caseId: string): Promise<void> {
    unwrap(
      await this.supabase.client(scope).from('eval_cases').delete().eq('id', caseId).eq('project_id', projectId).select('id').single(),
      'Pregunta no encontrada',
    );
  }

  async listRuns(scope: DataScope, projectId: string, limit: number): Promise<EvalRun[]> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('eval_runs')
        .select(RUN_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit),
    ) as EvalRun[];
  }

  async hasActiveRun(scope: DataScope, projectId: string, since: Date): Promise<boolean> {
    const { data } = await this.supabase
      .client(scope)
      .from('eval_runs')
      .select('id')
      .eq('project_id', projectId)
      .in('status', ['queued', 'running'])
      .gte('created_at', since.toISOString())
      .limit(1);
    return Boolean(data?.length);
  }

  async createRun(scope: DataScope, project: ProjectRef, total: number): Promise<EvalRun> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('eval_runs')
        .insert({ company_id: project.companyId, project_id: project.id, total })
        .select(RUN_COLUMNS)
        .single(),
    ) as EvalRun;
  }

  async getRun(scope: DataScope, projectId: string, runId: string): Promise<EvalRun & { results: unknown[] }> {
    const db = this.supabase.client(scope);
    const run = unwrap(
      await db.from('eval_runs').select(RUN_COLUMNS).eq('id', runId).eq('project_id', projectId).single(),
      'Ejecución no encontrada',
    ) as EvalRun;
    const results = unwrap(await db.from('eval_results').select(RESULT_COLUMNS).eq('run_id', runId).order('created_at'));
    return { ...run, results };
  }

  async findRun(runId: string) {
    const { data } = await this.supabase.admin
      .from('eval_runs')
      .select('id, company_id, project_id, status')
      .eq('id', runId)
      .maybeSingle();
    return (data as { id: string; company_id: string; project_id: string; status: EvalRunStatus } | null) ?? null;
  }

  async markRunning(runId: string): Promise<void> {
    await this.supabase.admin.from('eval_runs').update({ status: 'running' }).eq('id', runId);
  }

  async casesForProject(projectId: string) {
    const { data, error } = await this.supabase.admin
      .from('eval_cases')
      .select('id, question, must_include, must_not_include')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });
    check(error);
    return (data ?? []) as Array<Pick<EvalCase, 'id' | 'question' | 'must_include' | 'must_not_include'>>;
  }

  async completedCaseIds(runId: string): Promise<Set<string>> {
    const { data } = await this.supabase.admin.from('eval_results').select('case_id').eq('run_id', runId);
    return new Set((data ?? []).map((r) => r.case_id as string));
  }

  async saveResult(r: EvalResultInput): Promise<void> {
    const { error } = await this.supabase.admin.from('eval_results').upsert(
      {
        run_id: r.runId,
        company_id: r.companyId,
        case_id: r.caseId,
        question: r.question,
        answer: r.answer,
        passed: r.passed,
        missing: r.missing,
        forbidden: r.forbidden,
        model_info: r.modelInfo,
        duration_ms: r.durationMs,
        error: r.error,
      },
      { onConflict: 'run_id,case_id' },
    );
    check(error);
  }

  async finishRun(runId: string): Promise<{ passed: number; total: number }> {
    const { data: results } = await this.supabase.admin.from('eval_results').select('passed').eq('run_id', runId);
    const passed = (results ?? []).filter((r) => r.passed).length;
    const total = results?.length ?? 0;
    await this.supabase.admin
      .from('eval_runs')
      .update({ status: 'done', total, passed, failed: total - passed, finished_at: new Date().toISOString() })
      .eq('id', runId);
    return { passed, total };
  }

  async failRun(runId: string, message: string): Promise<void> {
    await this.supabase.admin
      .from('eval_runs')
      .update({ status: 'failed', error: message.slice(0, 1000), finished_at: new Date().toISOString() })
      .eq('id', runId);
  }
}
