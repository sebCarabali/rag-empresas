import { Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EmbeddingsService, toPgVector } from '../embeddings/embeddings.service';
import { ReindexService } from '../embeddings/reindex.service';
import { cacheModelKey, ModelSettingsService } from '../models/model-settings.service';
import { RerankerService } from '../rerank/reranker.service';
import { UsageService, type TokenUsage, type UsageChannel } from '../usage/usage.service';
import { AnswerCacheService, type CachedAnswer, type SemanticFields } from './answer-cache.service';
import { sameIntent } from './semantic-guard';
import { createCatalogExecutor, loadCatalogContext, type CatalogToolCall } from './catalog-tools';
import { loadEnrichments } from './enrichment-context';
import type { ChatTurn } from './gemini.service';
import { LlmService, type LlmRoute, type ModelInfo } from './llm.service';
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
/** Candidatos que se piden a la búsqueda antes de reordenar y diversificar. */
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
  /** Origen de la pregunta, para el panel de uso. Por defecto "app". */
  channel?: UsageChannel;
}

/** Cómo se encontró la respuesta en la caché. */
export interface CacheMatch {
  kind: 'exact' | 'semantic';
  /** Pregunta guardada que se reutilizó (solo por significado). */
  question?: string;
  similarity?: number;
}

export interface AskResult {
  answer: string;
  sources: Source[];
  toolCalls: CatalogToolCall[];
  modelInfo: ModelInfo | null;
  cached: boolean;
  cacheMatch: CacheMatch | null;
  usage: TokenUsage | null;
}

type Generated = Omit<AskResult, 'cached' | 'cacheMatch'>;

/** Modelos resueltos para una pregunta. */
interface GenerateContext {
  route: LlmRoute;
  embed: { model: string; companyId: string };
}

/**
 * Responde una pregunta sobre un proyecto, emitiendo eventos NDJSON:
 * caché (exacta o por significado) → búsqueda híbrida → descripciones web →
 * herramientas de catálogo → Gemini (clave de la empresa o de la plataforma)
 * con respaldo en Groq. Lo usan el chat de la app, el widget, las pruebas de
 * calidad y el precalentamiento de la caché.
 */
@Injectable()
export class ChatEngineService {
  private readonly logger = new Logger(ChatEngineService.name);

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly llm: LlmService,
    private readonly cache: AnswerCacheService,
    private readonly usage: UsageService,
    private readonly reranker: RerankerService,
    private readonly reindex: ReindexService,
    private readonly models: ModelSettingsService,
  ) {}

  async ask(input: AskInput, onPartial?: (answer: string) => void): Promise<AskResult> {
    const started = Date.now();
    const result = await this.answer(input, onPartial);
    void this.usage.record({
      companyId: input.companyId,
      projectId: input.projectId,
      channel: input.channel ?? 'app',
      cacheMatch: result.cached ? (result.cacheMatch?.kind ?? 'exact') : null,
      provider: result.modelInfo?.provider ?? null,
      model: result.modelInfo?.model ?? null,
      fallback: result.modelInfo?.fallback ?? false,
      keyOwner: result.modelInfo?.keyOwner ?? (result.modelInfo?.fallback ? 'platform' : null),
      usage: result.usage,
      durationMs: Date.now() - started,
    });
    return result;
  }

  private async answer(input: AskInput, onPartial?: (answer: string) => void): Promise<AskResult> {
    const { db, projectId, question, history, bot, emit } = input;

    // Modelos elegidos en la configuración del asistente (por defecto Gemini + Groq y E5 local).
    const settings = await this.models.get(projectId);
    const route = await this.models.route(input.companyId, settings);
    const embed = { model: settings.embeddingModel || this.embeddings.modelId(), companyId: input.companyId };
    const ctx: GenerateContext = { route, embed };

    // 1) Caché: cualquier pregunta que se entienda sola (no las de seguimiento).
    let cacheKey: string | null = null;
    let semantic: SemanticFields | null = null;
    let provisional: { hit: CachedAnswer; match: CacheMatch } | null = null;
    if (input.useCache !== false && this.cache.enabled && !AnswerCacheService.isFollowUp(question, history.length > 0)) {
      const version = await this.cache.contentVersion(db, projectId);
      const variant = botVariant(bot);
      const model = cacheModelKey(route.primary);
      cacheKey = this.cache.key(projectId, version, question, variant, model);
      semantic = { embedding: null, version, variant, model, embeddingModel: embed.model };

      let found: { hit: CachedAnswer; match: CacheMatch } | null = null;
      const exact = await this.cache.get(cacheKey);
      if (exact) found = { hit: exact, match: { kind: 'exact' } };
      // 1b) Por significado: una pregunta guardada parecida, con las mismas cifras y términos del catálogo.
      if (!found && this.cache.semanticEnabled) {
        semantic.embedding = await this.embeddings.embedQuery(question, embed);
        found = await this.findSimilar(db, projectId, question, semantic);
      }
      // 1c) La misma pregunta ya respondida por Gemini en el otro canal (chat interno / widget)
      // con el mismo contenido: se reutiliza en vez de volver a generar o de usar Groq.
      if (!found || found.hit.modelInfo?.fallback) {
        semantic.embedding ??= await this.embeddings.embedQuery(question, embed);
        found = (await this.findGeminiSibling(projectId, question, semantic)) ?? found;
      }
      if (found && !found.hit.modelInfo?.fallback) return this.serveCached(found.hit, emit, found.match);
      // Respuesta guardada del respaldo (Groq): es provisional. Se intenta con Gemini;
      // si responde, la reemplaza en la caché; si no, se entrega la guardada.
      provisional = found;
    }

    let result: Generated;
    try {
      result = await this.generate(input, ctx, { allowFallback: !provisional }, onPartial, semantic?.embedding ?? undefined);
    } catch (err) {
      if (!provisional || input.signal.aborted) throw err;
      emit({ type: 'reset' });
      onPartial?.('');
      return this.serveCached(provisional.hit, emit, provisional.match);
    }

    // Gemini no dio texto: mejor la respuesta provisional que una vacía.
    if (provisional && !result.answer.trim()) {
      emit({ type: 'reset' });
      return this.serveCached(provisional.hit, emit, provisional.match);
    }
    // Se cachean las respuestas de ambos modelos; una de Gemini reemplaza a la provisional de Groq.
    if (cacheKey && semantic && result.answer.trim()) {
      semantic.embedding ??= await this.embeddings.embedQuery(question, embed);
      await this.cache.put(cacheKey, projectId, question, result, semantic);
    }
    return { ...result, cached: false, cacheMatch: null };
  }

  private async findSimilar(
    db: SupabaseClient,
    projectId: string,
    question: string,
    semantic: SemanticFields,
  ): Promise<{ hit: CachedAnswer; match: CacheMatch } | null> {
    const candidates = await this.cache.similar(projectId, semantic, semantic.variant, semantic.embedding!);
    if (candidates.length === 0) return null;
    const vocabulary = await this.cache.vocabulary(db, projectId, semantic.version);
    for (const c of candidates) {
      if (!sameIntent(question, c.question, vocabulary)) {
        this.logger.log(`Caché por significado descartada (${c.similarity.toFixed(3)}): "${c.question}" ≠ "${question}"`);
        continue;
      }
      const hit = await this.cache.get(c.cache_key);
      if (hit) {
        this.logger.log(`Caché por significado (${c.similarity.toFixed(3)}): "${question}" → "${c.question}"`);
        return { hit, match: { kind: 'semantic', question: c.question, similarity: Number(c.similarity.toFixed(3)) } };
      }
    }
    return null;
  }

  /** Misma pregunta (normalizada) respondida por Gemini en otra variante, con el mismo contenido. */
  private async findGeminiSibling(
    projectId: string,
    question: string,
    semantic: SemanticFields,
  ): Promise<{ hit: CachedAnswer; match: CacheMatch } | null> {
    const normalized = AnswerCacheService.normalizeQuestion(question);
    const candidates = await this.cache.similar(projectId, semantic, null, semantic.embedding!, 0.97);
    for (const c of candidates) {
      if (c.variant === semantic.variant || AnswerCacheService.normalizeQuestion(c.question) !== normalized) continue;
      const hit = await this.cache.get(c.cache_key);
      if (hit && !hit.modelInfo?.fallback) {
        this.logger.log(`Caché de otra variante (${c.variant}): "${question}"`);
        return { hit, match: { kind: 'exact' } };
      }
    }
    return null;
  }

  private serveCached(hit: CachedAnswer, emit: Emit, match: CacheMatch): AskResult {
    if (hit.modelInfo) emit({ type: 'model', info: hit.modelInfo });
    emit({ type: 'sources', sources: hit.sources });
    for (const call of hit.toolCalls) emit({ type: 'tool', call });
    emit({ type: 'delta', text: hit.answer });
    return {
      answer: hit.answer,
      sources: hit.sources,
      toolCalls: hit.toolCalls,
      modelInfo: hit.modelInfo ?? null,
      cached: true,
      cacheMatch: match,
      usage: null,
    };
  }

  /** Genera una respuesta nueva: búsqueda, contexto, herramientas y modelo. */
  private async generate(
    input: AskInput,
    ctx: GenerateContext,
    options: { allowFallback: boolean },
    onPartial?: (answer: string) => void,
    precomputedEmbedding?: number[],
  ): Promise<Generated> {
    const { db, projectId, question, history, bot, emit, signal } = input;

    // Si el proyecto se indexó con otro modelo de embeddings, se reindexa en segundo plano
    // (mientras tanto la búsqueda por texto sigue funcionando).
    void this.reindex.ensureCurrent(projectId);

    // 2) Búsqueda híbrida, diversificada para que un producto no acapare el contexto.
    const queryEmbedding = precomputedEmbedding ?? (await this.embeddings.embedQuery(question, ctx.embed));
    const { data: matches, error } = await db.rpc('match_document_chunks', {
      p_project_id: projectId,
      query_embedding: toPgVector(queryEmbedding),
      query_text: question,
      match_count: MATCH_CANDIDATES,
      p_embedding_model: ctx.embed.model,
    });
    if (error) throw new Error(`Búsqueda: ${error.message}`);

    // 2b) Reordenador: lee pregunta y fragmento juntos y sube los que de verdad responden.
    const { items: ranked, reranked, ms } = await this.reranker.rerank(question, (matches ?? []) as RetrievedChunk[]);
    if (reranked) this.logger.debug(`Reordenados ${ranked.length} candidatos en ${ms} ms`);
    const chunks = diversify(ranked, MATCH_COUNT);
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

    // 4) Modelo elegido (con la clave de la empresa si la configuró) y su respaldo si falla.
    const turns: ChatTurn[] = [...history, { role: 'user', content: buildUserTurn(question, chunks, extras) }];
    let answer = '';
    let modelInfo: ModelInfo | null = null;
    let usage = null as TokenUsage | null;
    for await (const event of this.llm.run(systemInstruction, turns, {
      tools: catalog?.declarations,
      execute,
      signal,
      route: ctx.route,
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
      } else if (event.type === 'usage') {
        // Se suman todas las llamadas (rondas de herramientas, reintento y respaldo).
        usage = { input: (usage?.input ?? 0) + event.input, output: (usage?.output ?? 0) + event.output };
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
    return { answer, sources, toolCalls, modelInfo, usage };
  }
}

/**
 * Parte de la clave de caché que depende del asistente. Solo distingue el chat
 * interno del widget público (que oculta datos internos); cambiar el nombre, el
 * idioma o las instrucciones no invalida las respuestas ya guardadas.
 */
function botVariant(bot: BotProfile | null): string {
  return bot?.audience ?? '';
}
