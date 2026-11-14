import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { CompanyKeysService } from '../companies/company-keys.service';
import { EmbeddingsService, toPgVector } from '../embeddings/embeddings.service';
import { AnswerCacheService, type CachedAnswer } from './answer-cache.service';
import { createCatalogExecutor, loadCatalogContext, type CatalogToolCall } from './catalog-tools';
import { loadEnrichments } from './enrichment-context';
import type { ChatTurn } from './gemini.service';
import { LlmService, type ModelInfo } from './llm.service';
import {
  buildSystemInstruction,
  buildUserTurn,
  diversify,
  toSources,
  type BotProfile,
  type ExtraContext,
  type RetrievedChunk,
  type Source,
} from './prompt';

/** Fragmentos que se usan como contexto por pregunta. */
const MATCH_COUNT = 10;
/** Candidatos que se piden a la búsqueda antes de diversificar. */
const MATCH_CANDIDATES = 30;

export type Emit = (event: object) => void;

export interface AskInput {
  /** Cliente para leer datos: el del usuario (RLS) en la app; service_role en el widget. */
  db: SupabaseClient;
  projectId: string;
  companyId: string;
  question: string;
  history: ChatTurn[];
  bot: BotProfile | null;
  emit: Emit;
  signal: AbortSignal;
  /** false: ni lee ni escribe la caché (pruebas de calidad). Por defecto true. */
  useCache?: boolean;
}

export interface AskResult {
  answer: string;
  sources: Source[];
  toolCalls: CatalogToolCall[];
  modelInfo: ModelInfo | null;
  cached: boolean;
}

/**
 * Responde una pregunta sobre un proyecto, emitiendo eventos NDJSON:
 * caché → búsqueda híbrida → descripciones web → herramientas de catálogo
 * → Gemini (clave de la empresa o de la plataforma) con respaldo en Groq.
 * Lo usan el chat de la app y el widget público.
 */
@Injectable()
export class ChatEngineService {
  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly llm: LlmService,
    private readonly cache: AnswerCacheService,
    private readonly keys: CompanyKeysService,
  ) {}

  async ask(input: AskInput, onPartial?: (answer: string) => void): Promise<AskResult> {
    const { db, projectId, question, history, bot, emit } = input;

    // 1) Caché: cualquier pregunta que se entienda sola (no las de seguimiento).
    let cacheKey: string | null = null;
    let provisional: CachedAnswer | null = null;
    if (input.useCache !== false && this.cache.enabled && !AnswerCacheService.isFollowUp(question, history.length > 0)) {
      const version = await this.cache.contentVersion(db, projectId);
      cacheKey = this.cache.key(projectId, version, question, botVariant(bot));
      const hit = await this.cache.get(cacheKey);
      if (hit && !hit.modelInfo?.fallback) return this.serveCached(hit, emit);
      // Respuesta guardada del respaldo (Groq): es provisional. Se intenta con Gemini;
      // si responde, la reemplaza en la caché; si no, se entrega la guardada.
      provisional = hit;
    }

    let result: Omit<AskResult, 'cached'>;
    try {
      result = await this.generate(input, { allowFallback: !provisional }, onPartial);
    } catch (err) {
      if (!provisional || input.signal.aborted) throw err;
      emit({ type: 'reset' });
      onPartial?.('');
      return this.serveCached(provisional, emit);
    }

    // Gemini no dio texto: mejor la respuesta provisional que una vacía.
    if (provisional && !result.answer.trim()) {
      emit({ type: 'reset' });
      return this.serveCached(provisional, emit);
    }
    // Se cachean las respuestas de ambos modelos; una de Gemini reemplaza a la provisional de Groq.
    if (cacheKey && result.answer.trim()) {
      await this.cache.put(cacheKey, projectId, question, result);
    }
    return { ...result, cached: false };
  }

  private serveCached(hit: CachedAnswer, emit: Emit): AskResult {
    if (hit.modelInfo) emit({ type: 'model', info: hit.modelInfo });
    emit({ type: 'sources', sources: hit.sources });
    for (const call of hit.toolCalls) emit({ type: 'tool', call });
    emit({ type: 'delta', text: hit.answer });
    return { answer: hit.answer, sources: hit.sources, toolCalls: hit.toolCalls, modelInfo: hit.modelInfo ?? null, cached: true };
  }

  /** Genera una respuesta nueva: búsqueda, contexto, herramientas y modelo. */
  private async generate(
    input: AskInput,
    options: { allowFallback: boolean },
    onPartial?: (answer: string) => void,
  ): Promise<Omit<AskResult, 'cached'>> {
    const { db, projectId, question, history, bot, emit, signal } = input;

    // 2) Búsqueda híbrida, diversificada para que un producto no acapare el contexto.
    const queryEmbedding = await this.embeddings.embedQuery(question);
    const { data: matches, error } = await db.rpc('match_document_chunks', {
      p_project_id: projectId,
      query_embedding: toPgVector(queryEmbedding),
      query_text: question,
      match_count: MATCH_CANDIDATES,
    });
    if (error) throw new Error(`Búsqueda: ${error.message}`);

    const chunks = diversify((matches ?? []) as RetrievedChunk[], MATCH_COUNT);
    const sources = toSources(chunks);

    // Descripciones generales (web) de las familias que aparecen en la pregunta o los resultados.
    const enrichments = await loadEnrichments(db, projectId, question, chunks);
    const extras: ExtraContext[] = enrichments.map((e) => ({
      label: `${e.field} "${e.value}" — descripción general (web)`,
      content: e.description,
    }));
    enrichments.forEach((e) =>
      sources.push({
        index: sources.length + 1,
        documentId: '',
        documentName: `${e.field}: ${e.value} — descripción general (web)`,
        chunkIndex: -1,
        snippet: e.description.length > 280 ? `${e.description.slice(0, 280)}…` : e.description,
        kind: 'web',
        links: e.sources,
      }),
    );
    emit({ type: 'sources', sources });
    const baseSources = sources.length;

    // 3) Herramientas de catálogo (filtros exactos, conteos, rankings) si hay CSV procesados.
    const catalog = await loadCatalogContext(db, projectId);
    const toolCalls: CatalogToolCall[] = [];
    const execute = catalog ? createCatalogExecutor(db, projectId, sources, toolCalls) : undefined;
    const systemInstruction = buildSystemInstruction(bot, catalog?.instructions);

    // 4) Modelo: clave de Gemini de la empresa si la configuró; respaldo en Groq si falla.
    const geminiApiKey = await this.keys.getGeminiKey(input.companyId);
    const turns: ChatTurn[] = [...history, { role: 'user', content: buildUserTurn(question, chunks, extras) }];
    let answer = '';
    let modelInfo: ModelInfo | null = null;
    for await (const event of this.llm.run(systemInstruction, turns, {
      tools: catalog?.declarations,
      execute,
      signal,
      geminiApiKey,
      allowFallback: options.allowFallback,
    })) {
      if (event.type === 'text') {
        answer += event.text;
        onPartial?.(answer);
        emit({ type: 'delta', text: event.text });
      } else if (event.type === 'tool') {
        emit({ type: 'tool', call: toolCalls[toolCalls.length - 1] });
        // Las fuentes del catálogo se agregan a medida que el modelo consulta.
        emit({ type: 'sources', sources });
      } else if (event.type === 'model') {
        modelInfo = event.info;
        emit({ type: 'model', info: event.info });
      } else if (event.type === 'reset') {
        // El modelo principal falló a mitad de respuesta: se descarta lo parcial.
        answer = '';
        onPartial?.(answer);
        toolCalls.length = 0;
        sources.splice(baseSources);
        emit({ type: 'reset' });
        emit({ type: 'sources', sources });
      }
    }
    return { answer, sources, toolCalls, modelInfo };
  }
}

function botVariant(bot: BotProfile | null): string {
  if (!bot) return '';
  return createHash('sha256')
    .update([bot.audience, bot.name, bot.language, bot.instructions ?? ''].join('\u0000'))
    .digest('hex')
    .slice(0, 16);
}
