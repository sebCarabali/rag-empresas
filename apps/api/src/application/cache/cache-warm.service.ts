import { Injectable, Logger } from '@nestjs/common';
import { normalizeQuestion } from '../../domain/cache/questions';
import { ChatEngineService } from '../chat/chat-engine.service';
import { ChatbotsService } from '../chatbots/chatbots.service';
import { AppConfig } from '../../config/app-config';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export interface WarmJob {
  kind: 'warm';
  /** Ejecución creada por el botón. Si falta, es automática y se crea al procesarla. */
  runId?: string;
  projectId: string;
  batch?: number;
}

interface WarmQuestion {
  question: string;
  audience: 'internal' | 'public';
  origin: 'sugerida' | 'widget' | 'equipo';
}

/** Preguntas frecuentes que se precalientan, por origen. */
const TOP_WIDGET = 20;
const TOP_TEAM = 10;
/** Período para buscar las preguntas frecuentes. */
const LOOKBACK_DAYS = 30;
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
    private readonly supabase: SupabaseService,
    private readonly engine: ChatEngineService,
    private readonly chatbots: ChatbotsService,
    private readonly config: AppConfig,
  ) {}

  /** Preguntas a precalentar, sin repetidas (misma pregunta normalizada y audiencia). */
  async collect(projectId: string): Promise<WarmQuestion[]> {
    const db = this.supabase.admin;
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const bot = await this.chatbots.findByProject(db, projectId);
    const list: WarmQuestion[] = [];

    for (const q of bot?.suggested_questions ?? []) {
      list.push({ question: q, audience: 'internal', origin: 'sugerida' });
      if (bot?.widget_enabled) list.push({ question: q, audience: 'public', origin: 'sugerida' });
    }

    const { data: widget } = await db
      .from('widget_messages')
      .select('question')
      .eq('project_id', projectId)
      .gte('created_at', since)
      .limit(2000);
    for (const q of topQuestions((widget ?? []).map((r) => r.question as string), TOP_WIDGET)) {
      list.push({ question: q, audience: 'public', origin: 'widget' });
    }

    const { data: team } = await db
      .from('messages')
      .select('content, conversations!inner(project_id)')
      .eq('conversations.project_id', projectId)
      .eq('role', 'user')
      .gte('created_at', since)
      .limit(2000);
    for (const q of topQuestions((team ?? []).map((r) => r.content as string), TOP_TEAM)) {
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
    const db = this.supabase.admin;
    const started = Date.now();
    const { data: project } = await db.from('projects').select('id, company_id').eq('id', job.projectId).maybeSingle();
    if (!project) return {};

    // Mientras haya documentos procesándose, el contenido va a cambiar: lo precalentará el último.
    const { count: busy } = await db
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .in('status', ['pending', 'processing']);

    let runId = job.runId;
    if (!runId) {
      if (busy) return {};
      const { data: created, error } = await db
        .from('cache_warm_runs')
        .insert({ company_id: project.company_id, project_id: project.id, trigger: 'auto' })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      runId = created.id as string;
    }

    const { data: run } = await db
      .from('cache_warm_runs')
      .select('id, status, questions, done, generated')
      .eq('id', runId)
      .maybeSingle();
    if (!run || run.status === 'done' || run.status === 'failed' || run.status === 'skipped') return {};

    let questions = run.questions as WarmQuestion[];
    if (run.status === 'queued') {
      questions = await this.collect(project.id);
      await db
        .from('cache_warm_runs')
        .update({ status: 'running', questions, total: questions.length })
        .eq('id', runId);
    }

    let done = run.done as number;
    let generated = run.generated as number;
    const bots = new Map<string, ReturnType<ChatbotsService['profile']>>();
    const row = await this.chatbots.findByProject(db, project.id);

    for (; done < questions.length; done++) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        await db.from('cache_warm_runs').update({ done, generated }).eq('id', runId);
        return { next: { kind: 'warm', runId, projectId: project.id, batch: (job.batch ?? 0) + 1 } };
      }
      const w = questions[done];
      if (!bots.has(w.audience)) bots.set(w.audience, this.chatbots.profile(row, w.audience));
      try {
        const result = await this.engine.ask({
          db,
          projectId: project.id,
          companyId: project.company_id,
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
      if (done % 5 === 4) await db.from('cache_warm_runs').update({ done: done + 1, generated }).eq('id', runId);
    }

    await db
      .from('cache_warm_runs')
      .update({ status: 'done', done, generated, finished_at: new Date().toISOString() })
      .eq('id', runId);
    this.logger.log(`Caché precalentada en ${project.id}: ${generated} nuevas de ${questions.length}`);
    return {};
  }

  async markFailed(runId: string | undefined, message: string): Promise<void> {
    if (!runId) return;
    await this.supabase.admin
      .from('cache_warm_runs')
      .update({ status: 'failed', error: message.slice(0, 1000), finished_at: new Date().toISOString() })
      .eq('id', runId);
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
