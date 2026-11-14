import { Injectable, Logger } from '@nestjs/common';
import { ChatEngineService } from '../chat/chat-engine.service';
import { ChatbotsService } from '../chatbots/chatbots.service';
import { SupabaseService } from '../supabase/supabase.service';
import { evaluateAnswer } from './evaluate';

export interface EvalJob {
  kind: 'eval';
  runId: string;
  /** Número de lote (continuaciones cuando no alcanza el tiempo de la función). */
  batch?: number;
}

/** Margen bajo el límite de 300 s de Vercel para guardar y encolar el siguiente lote. */
const TIME_BUDGET_MS = 200_000;

/**
 * Ejecuta las pruebas de calidad de un proyecto: cada pregunta pasa por el mismo
 * motor del chat (sin caché, para medir la respuesta actual) y se comprueba que
 * contenga los textos esperados y ninguno de los prohibidos.
 */
@Injectable()
export class EvalRunnerService {
  private readonly logger = new Logger(EvalRunnerService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly engine: ChatEngineService,
    private readonly chatbots: ChatbotsService,
  ) {}

  async run(job: EvalJob): Promise<{ next?: EvalJob }> {
    const db = this.supabase.admin;
    const started = Date.now();

    const { data: run } = await db
      .from('eval_runs')
      .select('id, company_id, project_id, status')
      .eq('id', job.runId)
      .maybeSingle();
    if (!run || run.status === 'done' || run.status === 'failed') return {};
    if (run.status === 'queued') await db.from('eval_runs').update({ status: 'running' }).eq('id', run.id);

    const { data: cases, error } = await db
      .from('eval_cases')
      .select('id, question, must_include, must_not_include')
      .eq('project_id', run.project_id)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);

    const { data: doneRows } = await db.from('eval_results').select('case_id').eq('run_id', run.id);
    const done = new Set((doneRows ?? []).map((r) => r.case_id as string));
    const bot = this.chatbots.profile(await this.chatbots.findByProject(db, run.project_id), 'internal');

    for (const c of cases ?? []) {
      if (done.has(c.id)) continue;
      if (Date.now() - started > TIME_BUDGET_MS) {
        return { next: { kind: 'eval', runId: run.id, batch: (job.batch ?? 0) + 1 } };
      }
      const caseStarted = Date.now();
      let answer = '';
      let modelInfo: unknown = null;
      let caseError: string | null = null;
      try {
        const result = await this.engine.ask({
          db,
          projectId: run.project_id,
          companyId: run.company_id,
          question: c.question,
          history: [],
          bot,
          emit: () => undefined,
          signal: new AbortController().signal,
          useCache: false,
          channel: 'eval',
        });
        answer = result.answer;
        modelInfo = result.modelInfo;
      } catch (err) {
        caseError = (err as Error).message;
      }
      const outcome = evaluateAnswer(answer, c.must_include ?? [], c.must_not_include ?? []);
      const { error: insertError } = await db.from('eval_results').upsert(
        {
          run_id: run.id,
          company_id: run.company_id,
          case_id: c.id,
          question: c.question,
          answer,
          passed: !caseError && outcome.passed,
          missing: outcome.missing,
          forbidden: outcome.forbidden,
          model_info: modelInfo,
          duration_ms: Date.now() - caseStarted,
          error: caseError,
        },
        { onConflict: 'run_id,case_id' },
      );
      if (insertError) throw new Error(insertError.message);
    }

    const { data: results } = await db.from('eval_results').select('passed').eq('run_id', run.id);
    const passed = (results ?? []).filter((r) => r.passed).length;
    const total = results?.length ?? 0;
    await db
      .from('eval_runs')
      .update({ status: 'done', total, passed, failed: total - passed, finished_at: new Date().toISOString() })
      .eq('id', run.id);
    this.logger.log(`Prueba ${run.id}: ${passed}/${total} correctas`);
    return {};
  }

  async markFailed(runId: string, message: string): Promise<void> {
    await this.supabase.admin
      .from('eval_runs')
      .update({ status: 'failed', error: message.slice(0, 1000), finished_at: new Date().toISOString() })
      .eq('id', runId);
  }
}
