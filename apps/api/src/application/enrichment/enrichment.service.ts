import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PROVIDER_KEY_READER,
  USAGE_RECORDER,
  WEB_RESEARCHER,
  type ProviderKeyReader,
  type UsageRecorder,
  type WebResearcher,
} from '../ports';
import { AppConfig } from '../../config/app-config';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

/** Trabajo de la cola: generar descripciones web para un proyecto. */
export interface EnrichJob {
  kind: 'enrich';
  projectId: string;
  /** Regenera también las descripciones existentes. */
  force?: boolean;
}

interface DistinctValue {
  campo: string;
  valor: string;
  productos: number;
  contexto: { composiciones?: string[]; tipos_de_tejido?: string[] };
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
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
    @Inject(PROVIDER_KEY_READER) private readonly keys: ProviderKeyReader,
    @Inject(USAGE_RECORDER) private readonly usage: UsageRecorder,
    @Inject(WEB_RESEARCHER) private readonly researcher: WebResearcher,
  ) {}


  async run(job: EnrichJob): Promise<{ next?: EnrichJob }> {
    if (!this.config.webEnrichment || this.config.enrichFields.length === 0) return {};
    const started = Date.now();
    const db = this.supabase.admin;

    const { data: project } = await db.from('projects').select('id, company_id').eq('id', job.projectId).maybeSingle();
    if (!project) return {};

    const { data: values, error } = await db.rpc('catalog_distinct_values', {
      p_project_id: project.id,
      p_fields: this.config.enrichFields,
    });
    if (error) throw new Error(`catalog_distinct_values: ${error.message}`);
    const list = (values ?? []) as DistinctValue[];
    if (list.length === 0) return {};

    if (job.force) {
      await db.from('catalog_enrichments').update({ status: 'pending', error: null }).eq('project_id', project.id);
    }
    // Registra como pendientes los valores nuevos (los existentes se conservan).
    const { error: insError } = await db.from('catalog_enrichments').upsert(
      list.map((v) => ({ company_id: project.company_id, project_id: project.id, field: v.campo, value: v.valor })),
      { onConflict: 'project_id,field,value', ignoreDuplicates: true },
    );
    if (insError) throw new Error(`catalog_enrichments: ${insError.message}`);

    const { data: pending } = await db
      .from('catalog_enrichments')
      .select('id, field, value')
      .eq('project_id', project.id)
      .eq('status', 'pending');

    // Las búsquedas se hacen con la clave de Gemini del asistente; sin ella se omiten.
    const geminiKey = await this.keys.getKey(project.id, 'gemini');
    if (!geminiKey) {
      this.logger.log(`Proyecto ${project.id}: sin clave de Gemini en el asistente; se omiten las descripciones web`);
      return {};
    }
    const byKey = new Map(list.map((v) => [`${v.campo}\u0000${v.valor}`, v]));
    let done = 0;
    for (const row of pending ?? []) {
      if (done > 0 && Date.now() - started > TIME_BUDGET_MS) {
        this.logger.log(`Proyecto ${project.id}: quedan descripciones; continúa en otro trabajo`);
        return { next: { kind: 'enrich', projectId: project.id } };
      }
      const info = byKey.get(`${row.field}\u0000${row.value}`);
      try {
        const callStarted = Date.now();
        const result = await this.researcher.describe(row.field, row.value, info?.contexto ?? {}, geminiKey);
        void this.usage.record({
          companyId: project.company_id,
          projectId: project.id,
          channel: 'enrich',
          provider: 'gemini',
          model: this.config.geminiModel,
          keyOwner: 'company',
          usage: result.usage,
          durationMs: Date.now() - callStarted,
        });
        await db
          .from('catalog_enrichments')
          .update({
            status: 'ready',
            description: result.description,
            sources: result.sources,
            search_queries: result.queries,
            model: this.config.geminiModel,
            error: null,
          })
          .eq('id', row.id);
      } catch (err) {
        const message = friendlyError(err);
        this.logger.warn(`Descripción de ${row.field}=${row.value} falló: ${message}`);
        await db.from('catalog_enrichments').update({ status: 'failed', error: message }).eq('id', row.id);
        // Sin facturación o con la cuota agotada fallarán todas: no seguir gastando intentos.
        if (/facturaci|cuota/i.test(message)) {
          await db
            .from('catalog_enrichments')
            .update({ status: 'failed', error: message })
            .eq('project_id', project.id)
            .eq('status', 'pending');
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
