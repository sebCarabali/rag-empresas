import { Inject, Injectable, Logger } from '@nestjs/common';
import { normalizeQuestion } from '../../domain/cache/questions';
import { ChatEngineService } from '../chat/chat-engine.service';
import { ChatbotsService } from '../chatbots/chatbots.service';
import { AppConfig } from '../../config/app-config';
import {
  DOCUMENT_REPOSITORY,
  PROJECT_REPOSITORY,
  QUESTION_HISTORY,
  SYSTEM_SCOPE,
  WARM_RUN_REPOSITORY,
  type DocumentRepository,
  type ProjectRepository,
  type QuestionHistory,
  type WarmQuestion,
  type WarmRunRepository,
} from '../ports';

export interface WarmJob {
  kind: 'warm';
  /** Ejecución creada por el botón. Si falta, es automática y se crea al procesarla. */
  runId?: string;
  projectId: string;
  batch?: number;
}

/** Preguntas frecuentes que se precalientan, por origen. */
const TOP_WIDGET = 20;
const TOP_TEAM = 10;
/** Período para buscar las preguntas frecuentes. */
const LOOKBACK_DAYS = 30;
/** Preguntas recientes que se leen por origen. */
const HISTORY_LIMIT = 2000;
const TIME_BUDGET_MS = 200_000;

/**
 * Precalienta la caché: genera de antemano las respuestas a las preguntas
 * sugeridas del asistente y a las más frecuentes del widget y del equipo, para
 * que el primer visitante que las haga reciba la respuesta al instante. Corre en
 * la cola; las que ya están en caché no se vuelven a generar.
 */
@Injectable()
export class CacheWarmService {
  private readonly logger = new Logger(CacheWarmService.name);

  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepository,
    @Inject(WARM_RUN_REPOSITORY) private readonly runs: WarmRunRepository,
    @Inject(QUESTION_HISTORY) private readonly history: QuestionHistory,
    private readonly engine: ChatEngineService,
    private readonly chatbots: ChatbotsService,
    private readonly config: AppConfig,
  ) {}

  /** Preguntas a precalentar, sin repetidas (misma pregunta normalizada y audiencia). */
  async collect(projectId: string): Promise<WarmQuestion[]> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const bot = await this.chatbots.findByProject(SYSTEM_SCOPE, projectId);
    const list: WarmQuestion[] = [];

    for (const q of bot?.suggested_questions ?? []) {
      list.push({ question: q, audience: 'internal', origin: 'sugerida' });
      if (bot?.widget_enabled) list.push({ question: q, audience: 'public', origin: 'sugerida' });
    }

    const widget = await this.history.widgetQuestions(projectId, since, HISTORY_LIMIT);
    for (const q of topQuestions(widget, TOP_WIDGET)) {
      list.push({ question: q, audience: 'public', origin: 'widget' });
    }

    const team = await this.history.teamQuestions(projectId, since, HISTORY_LIMIT);
    for (const q of topQuestions(team, TOP_TEAM)) {
      list.push({ question: q, audience: 'internal', origin: 'equipo' });
    }

    const seen = new Set<string>();
    return list.filter((w) => {
      const id = `${w.audience}|${normalizeQuestion(w.question)}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  async run(job: WarmJob): Promise<{ next?: WarmJob }> {
    const started = Date.now();
    const project = await this.projects.findRef(job.projectId);
    if (!project) return {};

    let runId = job.runId;
    if (!runId) {
      // Mientras haya documentos procesándose, el contenido va a cambiar: lo precalentará el último.
      if (await this.documents.countProcessing(project.id)) return {};
      runId = (await this.runs.create(project, 'auto')).id;
    }

    const run = await this.runs.find(runId);
    if (!run || run.status === 'done' || run.status === 'failed' || run.status === 'skipped') return {};

    let questions = run.questions;
    if (run.status === 'queued') {
      questions = await this.collect(project.id);
      await this.runs.start(runId, questions);
    }

    let done = run.done;
    let generated = run.generated;
    const bots = new Map<string, ReturnType<ChatbotsService['profile']>>();
    const row = await this.chatbots.findByProject(SYSTEM_SCOPE, project.id);

    for (; done < questions.length; done++) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        await this.runs.saveProgress(runId, done, generated);
        return { next: { kind: 'warm', runId, projectId: project.id, batch: (job.batch ?? 0) + 1 } };
      }
      const w = questions[done];
      if (!bots.has(w.audience)) bots.set(w.audience, this.chatbots.profile(row, w.audience));
      try {
        const result = await this.engine.ask({
          scope: SYSTEM_SCOPE,
          projectId: project.id,
          companyId: project.companyId,
          question: w.question,
          history: [],
          bot: bots.get(w.audience)!,
          emit: () => undefined,
          signal: new AbortController().signal,
          channel: 'warm',
        });
        if (!result.cached) generated++;
      } catch (err) {
        // Una pregunta que falla no detiene el resto (p. ej. cuota agotada en una).
        this.logger.warn(`Precalentamiento "${w.question}": ${(err as Error).message}`);
      }
      if (done % 5 === 4) await this.runs.saveProgress(runId, done + 1, generated);
    }

    await this.runs.finish(runId, done, generated);
    this.logger.log(`Caché precalentada en ${project.id}: ${generated} nuevas de ${questions.length}`);
    return {};
  }

  async markFailed(runId: string | undefined, message: string): Promise<void> {
    if (!runId) return;
    await this.runs.fail(runId, message);
  }

  get autoEnabled(): boolean {
    return this.config.cacheWarmAuto;
  }
}

/** Preguntas que se repiten al menos dos veces, de la más a la menos frecuente. */
export function topQuestions(questions: string[], limit: number): string[] {
  const counts = new Map<string, { text: string; n: number }>();
  for (const q of questions) {
    const key = normalizeQuestion(q ?? '');
    if (key.split(' ').length < 3) continue; // demasiado corta para entenderse sola
    const entry = counts.get(key) ?? { text: q.trim(), n: 0 };
    entry.n++;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .filter((e) => e.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((e) => e.text);
}
