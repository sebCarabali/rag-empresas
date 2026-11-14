import { Injectable, Logger } from '@nestjs/common';
import { geminiClient } from '../chat/gemini.service';
import { CompanyKeysService } from '../companies/company-keys.service';
import { AppConfig } from '../config/app-config';
import { geminiUsage, UsageService, type TokenUsage } from '../usage/usage.service';
import { SupabaseService } from '../supabase/supabase.service';

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

export interface WebDescription {
  description: string;
  sources: Array<{ title: string; url: string }>;
  queries: string[];
  usage?: TokenUsage | null;
}

/** Margen bajo el límite de la función para encolar el resto. */
const TIME_BUDGET_MS = 200_000;
const MAX_SOURCES = 5;

/**
 * Enriquece el catálogo con descripciones generales de cada familia / tipo de
 * tela, usando Gemini con búsqueda en Google. Se hace una sola vez por valor y
 * proyecto (las búsquedas tienen costo), y se reutiliza en el chat.
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  /** Cliente con la clave de la plataforma (se puede reemplazar en pruebas). */
  private ai: ReturnType<typeof geminiClient>;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
    private readonly keys: CompanyKeysService,
    private readonly usage: UsageService,
  ) {
    this.ai = geminiClient(config.geminiApiKey);
  }

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

    // Las búsquedas se hacen con la clave de Gemini de la empresa si la configuró.
    const companyKey = await this.keys.getGeminiKey(project.company_id);
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
        const result = await this.describe(row.field, row.value, info?.contexto ?? {}, companyKey);
        void this.usage.record({
          companyId: project.company_id,
          projectId: project.id,
          channel: 'enrich',
          provider: 'gemini',
          model: this.config.geminiModel,
          keyOwner: companyKey ? 'company' : 'platform',
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

  /** Pide a Gemini (con Google Search) una descripción general verificable. */
  async describe(
    field: string,
    value: string,
    context: { composiciones?: string[]; tipos_de_tejido?: string[] },
    apiKey?: string | null,
  ): Promise<WebDescription> {
    const details = [
      context.tipos_de_tejido?.length ? `tejido ${context.tipos_de_tejido.join(' / ').toLowerCase()}` : null,
      context.composiciones?.length ? `composiciones frecuentes: ${context.composiciones.join('; ')}` : null,
    ]
      .filter(Boolean)
      .join('; ');

    const prompt =
      `Escribe una descripción general, en español, del tipo de tela "${value}" ` +
      `(${field.toLowerCase()} en un catálogo de telas de Colombia${details ? `; ${details}` : ''}).\n` +
      'Incluye qué es, sus características (tacto, caída, elasticidad, transpirabilidad), ' +
      'usos típicos en confección y cuidados de lavado.\n' +
      'Reglas: un solo párrafo de máximo 120 palabras, sin títulos ni listas. ' +
      'No inventes marcas, precios ni datos de un fabricante. Si el nombre parece una denominación comercial ' +
      'o una agrupación interna, describe la categoría textil general que corresponde según el contexto.';

    const ai = apiKey ? geminiClient(apiKey) : this.ai;
    const response = await ai.models.generateContent({
      model: this.config.geminiModel,
      contents: prompt,
      config: {
        systemInstruction:
          'Eres un experto textil. Usa la búsqueda de Google para basarte en información pública verificable.',
        tools: [{ googleSearch: {} }],
      },
    });

    const description = (response.text ?? '').trim();
    if (!description) throw new Error('El modelo no devolvió una descripción');

    const meta = response.candidates?.[0]?.groundingMetadata;
    const seen = new Set<string>();
    const sources: WebDescription['sources'] = [];
    for (const chunk of meta?.groundingChunks ?? []) {
      const url = chunk.web?.uri;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ title: chunk.web?.title || chunk.web?.domain || 'Fuente web', url });
      if (sources.length === MAX_SOURCES) break;
    }
    return { description, sources, queries: meta?.webSearchQueries ?? [], usage: geminiUsage(response.usageMetadata) };
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
