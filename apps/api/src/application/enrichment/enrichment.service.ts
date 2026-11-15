import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CATALOG_REPOSITORY,
  ENRICHMENT_REPOSITORY,
  PROJECT_REPOSITORY,
  PROVIDER_KEY_READER,
  USAGE_RECORDER,
  WEB_RESEARCHER,
  type CatalogRepository,
  type EnrichmentRepository,
  type ProjectRepository,
  type ProviderKeyReader,
  type UsageRecorder,
  type WebResearcher,
} from '../ports';
import { AppConfig } from '../../config/app-config';

/** Trabajo de la cola: generar descripciones web para un proyecto. */
export interface EnrichJob {
  kind: 'enrich';
  projectId: string;
  /** Regenera también las descripciones existentes. */
  force?: boolean;
}

/** Margen bajo el límite de la función para encolar el resto. */
const TIME_BUDGET_MS = 200_000;

/**
 * Enriquece el catálogo con descripciones generales de cada familia / tipo de
 * tela, usando Gemini con búsqueda en Google. Se hace una sola vez por valor y
 * proyecto (las búsquedas tienen costo), y se reutiliza en el chat.
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    @Inject(ENRICHMENT_REPOSITORY) private readonly enrichments: EnrichmentRepository,
    private readonly config: AppConfig,
    @Inject(PROVIDER_KEY_READER) private readonly keys: ProviderKeyReader,
    @Inject(USAGE_RECORDER) private readonly usage: UsageRecorder,
    @Inject(WEB_RESEARCHER) private readonly researcher: WebResearcher,
  ) {}


  async run(job: EnrichJob): Promise<{ next?: EnrichJob }> {
    if (!this.config.webEnrichment || this.config.enrichFields.length === 0) return {};
    const started = Date.now();
    const project = await this.projects.findRef(job.projectId);
    if (!project) return {};

    const list = await this.catalog.distinctValues(project.id, this.config.enrichFields);
    if (list.length === 0) return {};

    if (job.force) await this.enrichments.resetAll(project.id);
    // Registra como pendientes los valores nuevos (los existentes se conservan).
    await this.enrichments.registerValues(project, list.map((v) => ({ field: v.campo, value: v.valor })));
    const pending = await this.enrichments.pending(project.id);

    // Las búsquedas se hacen con la clave de Gemini del asistente; sin ella se omiten.
    const geminiKey = await this.keys.getKey(project.id, 'gemini');
    if (!geminiKey) {
      this.logger.log(`Proyecto ${project.id}: sin clave de Gemini en el asistente; se omiten las descripciones web`);
      return {};
    }
    const byKey = new Map(list.map((v) => [`${v.campo}\u0000${v.valor}`, v]));
    let done = 0;
    for (const row of pending) {
      if (done > 0 && Date.now() - started > TIME_BUDGET_MS) {
        this.logger.log(`Proyecto ${project.id}: quedan descripciones; continúa en otro trabajo`);
        return { next: { kind: 'enrich', projectId: project.id } };
      }
      const info = byKey.get(`${row.field}\u0000${row.value}`);
      try {
        const callStarted = Date.now();
        const result = await this.researcher.describe(row.field, row.value, info?.contexto ?? {}, geminiKey);
        void this.usage.record({
          companyId: project.companyId,
          projectId: project.id,
          channel: 'enrich',
          provider: 'gemini',
          model: this.config.geminiModel,
          keyOwner: 'company',
          usage: result.usage,
          durationMs: Date.now() - callStarted,
        });
        await this.enrichments.markReady(row.id, {
          description: result.description,
          sources: result.sources,
          queries: result.queries,
          model: this.config.geminiModel,
        });
      } catch (err) {
        const message = friendlyError(err);
        this.logger.warn(`Descripción de ${row.field}=${row.value} falló: ${message}`);
        await this.enrichments.markFailed(row.id, message);
        // Sin facturación o con la cuota agotada fallarán todas: no seguir gastando intentos.
        if (/facturaci|cuota/i.test(message)) {
          await this.enrichments.failPending(project.id, message);
          return {};
        }
      }
      done++;
    }
    this.logger.log(`Proyecto ${project.id}: ${done} descripciones web generadas`);
    return {};
  }
}

/** Traduce los errores habituales de la API a un mensaje útil para el usuario. */
function friendlyError(err: unknown): string {
  const raw = (err as Error)?.message ?? String(err);
  if (/billing|not available|free tier|permission|grounding/i.test(raw) && /search|ground|tool/i.test(raw)) {
    return 'La búsqueda web de Gemini requiere una clave con facturación activa.';
  }
  if (/quota|rate|429|exhausted/i.test(raw)) return 'Se agotó la cuota de búsquedas de Gemini; intenta más tarde.';
  return raw.slice(0, 300);
}
