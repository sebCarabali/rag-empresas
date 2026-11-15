import { Inject, Injectable, Logger } from '@nestjs/common';
import { isFollowUp } from '../../domain/cache/questions';
import {
  buildSystemInstruction,
  buildUserTurn,
  diversify,
  toSources,
  type BotProfile,
  type Source,
} from '../../domain/chat/prompt';
import { cacheModelKey, type ChatTurn, type LlmRoute, type ModelInfo, type TokenUsage } from '../../domain/llm/llm';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { ReindexService } from '../embeddings/reindex.service';
import { LlmService } from '../llm/llm.service';
import { ModelSettingsService } from '../models/model-settings.service';
import {
  ANSWER_CACHE,
  KNOWLEDGE_BASE_FACTORY,
  RERANKER,
  USAGE_RECORDER,
  type AnswerCache,
  type CachedAnswer,
  type CatalogToolCall,
  type DataScope,
  type KnowledgeBase,
  type KnowledgeBaseFactory,
  type Reranker,
  type SemanticFields,
  type UsageChannel,
  type UsageRecorder,
} from '../ports';
import { CacheLookupChain, type CacheFound, type CacheMatch } from './cache-lookup';

export type { CacheMatch };

/** Fragmentos que se usan como contexto por pregunta. */
const MATCH_COUNT = 10;
/** Candidatos que se piden a la búsqueda antes de reordenar y diversificar. */
const MATCH_CANDIDATES = 30;

export type Emit = (event: object) => void;

export interface AskInput {
  /** Ámbito de datos: el cliente del usuario (RLS) en la app; service_role en el widget y la API. */
  db: DataScope;
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

/** Todo lo resuelto para una pregunta: modelos, embeddings y datos del proyecto. */
interface QuestionContext {
  input: AskInput;
  route: LlmRoute;
  embed: { model: string; projectId: string };
  knowledge: KnowledgeBase;
}

/**
 * Caso de uso «responder una pregunta» (Facade sobre los puertos): caché
 * (cadena exacta → por significado → otro canal) → búsqueda híbrida →
 * reordenador → descripciones web → herramientas del catálogo → modelo elegido
 * con su respaldo. Lo usan el chat de la app, el widget, la API pública, las
 * pruebas de calidad y el precalentamiento de la caché. No conoce Supabase ni
 * las APIs de los modelos: solo puertos.
 */
@Injectable()
export class ChatEngineService {
  private readonly logger = new Logger(ChatEngineService.name);
  private readonly lookup: CacheLookupChain;

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly llm: LlmService,
    @Inject(ANSWER_CACHE) private readonly cache: AnswerCache,
    @Inject(USAGE_RECORDER) private readonly usage: UsageRecorder,
    @Inject(RERANKER) private readonly reranker: Reranker,
    private readonly reindex: ReindexService,
    private readonly models: ModelSettingsService,
    @Inject(KNOWLEDGE_BASE_FACTORY) private readonly knowledge: KnowledgeBaseFactory,
  ) {
    this.lookup = CacheLookupChain.standard(cache);
  }

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
      keyOwner: result.modelInfo ? 'company' : null,
      usage: result.usage,
      durationMs: Date.now() - started,
    });
    return result;
  }

  private async answer(input: AskInput, onPartial?: (answer: string) => void): Promise<AskResult> {
    const { projectId, question, history, bot, emit } = input;

    // Modelos elegidos en la configuración del asistente, con sus claves.
    const settings = await this.models.get(projectId);
    const ctx: QuestionContext = {
      input,
      route: await this.models.route(projectId, settings),
      embed: { model: settings.embeddingModel || this.embeddings.modelId(), projectId },
      knowledge: this.knowledge.forScope(input.db),
    };

    // 1) Caché: cualquier pregunta que se entienda sola (no las de seguimiento).
    let cacheKey: string | null = null;
    let semantic: SemanticFields | null = null;
    let provisional: CacheFound | null = null;
    if (input.useCache !== false && this.cache.enabled && !isFollowUp(question, history.length > 0)) {
      const version = await ctx.knowledge.contentVersion(projectId);
      const variant = botVariant(bot);
      const model = cacheModelKey(ctx.route.primary);
      cacheKey = this.cache.key(projectId, version, question, variant, model);
      const fields: SemanticFields = { embedding: null, version, variant, model, embeddingModel: ctx.embed.model };
      semantic = fields;

      const found = await this.lookup.find({
        projectId,
        question,
        key: cacheKey,
        semantic: fields,
        knowledge: ctx.knowledge,
        embedQuestion: async () => (fields.embedding ??= await this.embeddings.embedQuery(question, ctx.embed)),
      });
      if (found && !found.hit.modelInfo?.fallback) return this.serveCached(found.hit, emit, found.match);
      // Respuesta guardada del respaldo: es provisional. Se intenta con el principal;
      // si responde, la reemplaza en la caché; si no, se entrega la guardada.
      provisional = found;
    }

    let result: Generated;
    try {
      result = await this.generate(ctx, { allowFallback: !provisional }, onPartial, semantic?.embedding ?? undefined);
    } catch (err) {
      if (!provisional || input.signal.aborted) throw err;
      emit({ type: 'reset' });
      onPartial?.('');
      return this.serveCached(provisional.hit, emit, provisional.match);
    }

    // El principal no dio texto: mejor la respuesta provisional que una vacía.
    if (provisional && !result.answer.trim()) {
      emit({ type: 'reset' });
      return this.serveCached(provisional.hit, emit, provisional.match);
    }
    // Se cachean las respuestas de ambos modelos; una del principal reemplaza a la provisional.
    if (cacheKey && semantic && result.answer.trim()) {
      semantic.embedding ??= await this.embeddings.embedQuery(question, ctx.embed);
      await this.cache.put(cacheKey, projectId, question, result, semantic);
    }
    return { ...result, cached: false, cacheMatch: null };
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
    ctx: QuestionContext,
    options: { allowFallback: boolean },
    onPartial?: (answer: string) => void,
    precomputedEmbedding?: number[],
  ): Promise<Generated> {
    const { projectId, question, history, bot, emit, signal } = ctx.input;
    const { knowledge } = ctx;

    // Si el proyecto se indexó con otro modelo de embeddings, se reindexa en segundo plano
    // (mientras tanto la búsqueda por texto sigue funcionando).
    void this.reindex.ensureCurrent(projectId);

    // 2) Búsqueda híbrida.
    const embedding = precomputedEmbedding ?? (await this.embeddings.embedQuery(question, ctx.embed));
    const matches = await knowledge.searchChunks({
      projectId,
      question,
      embedding,
      embeddingModel: ctx.embed.model,
      limit: MATCH_CANDIDATES,
    });

    // 2b) Reordenador: lee pregunta y fragmento juntos y sube los que de verdad responden;
    // luego se diversifica para que un producto no acapare el contexto.
    const { items: ranked, reranked, ms } = await this.reranker.rerank(question, matches);
    if (reranked) this.logger.debug(`Reordenados ${ranked.length} candidatos en ${ms} ms`);
    const chunks = diversify(ranked, MATCH_COUNT);
    const sources = toSources(chunks);

    // Descripciones generales (web) de las familias que aparecen en la pregunta o los resultados.
    const extras = await knowledge.webDescriptions(projectId, question, chunks);
    for (const e of extras) {
      sources.push({
        index: sources.length + 1,
        documentId: '',
        documentName: `${e.field}: ${e.value} — descripción general (web)`,
        chunkIndex: -1,
        snippet: e.content.length > 280 ? `${e.content.slice(0, 280)}…` : e.content,
        kind: 'web',
        links: e.sources,
      });
    }
    emit({ type: 'sources', sources });
    const baseSources = sources.length;

    // 3) Herramientas de catálogo (filtros exactos, conteos, rankings) si hay CSV procesados.
    const catalog = await knowledge.catalogTools(projectId);
    const toolCalls: CatalogToolCall[] = [];
    const execute = catalog?.createExecutor(sources, toolCalls);
    const systemInstruction = buildSystemInstruction(bot, catalog?.instructions);

    // 4) Modelo elegido (con la clave del asistente) y su respaldo si falla.
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
