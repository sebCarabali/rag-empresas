import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChatEngineService } from '../chat/chat-engine.service';
import { ChatbotsService } from '../chatbots/chatbots.service';
import { evaluateAnswer } from '../../domain/evals/evaluate';
import type { ModelInfo } from '../../domain/llm/llm';
import { EVAL_REPOSITORY, SYSTEM_SCOPE, type EvalRepository } from '../ports';

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
    @Inject(EVAL_REPOSITORY) private readonly evals: EvalRepository,
    private readonly engine: ChatEngineService,
    private readonly chatbots: ChatbotsService,
  ) {}

  async run(job: EvalJob): Promise<{ next?: EvalJob }> {
    const started = Date.now();

    const run = await this.evals.findRun(job.runId);
    if (!run || run.status === 'done' || run.status === 'failed') return {};
    if (run.status === 'queued') await this.evals.markRunning(run.id);

    const cases = await this.evals.casesForProject(run.project_id);
    const done = await this.evals.completedCaseIds(run.id);
    const bot = this.chatbots.profile(await this.chatbots.findByProject(SYSTEM_SCOPE, run.project_id), 'internal');

    for (const c of cases) {
      if (done.has(c.id)) continue;
      if (Date.now() - started > TIME_BUDGET_MS) {
        return { next: { kind: 'eval', runId: run.id, batch: (job.batch ?? 0) + 1 } };
      }
      const caseStarted = Date.now();
      let answer = '';
      let modelInfo: ModelInfo | null = null;
      let caseError: string | null = null;
      try {
        const result = await this.engine.ask({
          scope: SYSTEM_SCOPE,
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
      await this.evals.saveResult({
        runId: run.id,
        companyId: run.company_id,
        caseId: c.id,
        question: c.question,
        answer,
        passed: !caseError && outcome.passed,
        missing: outcome.missing,
        forbidden: outcome.forbidden,
        modelInfo,
        durationMs: Date.now() - caseStarted,
        error: caseError,
      });
    }

    const { passed, total } = await this.evals.finishRun(run.id);
    this.logger.log(`Prueba ${run.id}: ${passed}/${total} correctas`);
    return {};
  }

  async markFailed(runId: string, message: string): Promise<void> {
    await this.evals.failRun(runId, message);
  }
}
