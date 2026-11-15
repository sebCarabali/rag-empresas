import { Logger } from '@nestjs/common';
import { normalizeQuestion } from '../../domain/cache/questions';
import { sameIntent } from '../../domain/cache/semantic-guard';
import type { AnswerCache, CachedAnswer, KnowledgeBase, SemanticFields } from '../ports';

/** Cómo se encontró la respuesta en la caché. */
export interface CacheMatch {
  kind: 'exact' | 'semantic';
  /** Pregunta guardada que se reutilizó (solo por significado). */
  question?: string;
  similarity?: number;
}

export interface CacheFound {
  hit: CachedAnswer;
  match: CacheMatch;
}

/** Lo que necesita cada eslabón para buscar. */
export interface LookupContext {
  projectId: string;
  question: string;
  key: string;
  semantic: SemanticFields;
  knowledge: KnowledgeBase;
  /** Calcula (una sola vez) el embedding de la pregunta y lo deja en semantic.embedding. */
  embedQuestion(): Promise<number[]>;
}

/**
 * Eslabón de la cadena de búsqueda en caché (Chain of Responsibility). Recibe
 * lo encontrado hasta ahora y decide si busca o lo deja pasar.
 */
export interface CacheLookupHandler {
  handle(ctx: LookupContext, found: CacheFound | null): Promise<CacheFound | null>;
}

const isProvisional = (f: CacheFound | null) => Boolean(f?.hit.modelInfo?.fallback);

/** 1) La misma pregunta (normalizada), mismo canal, mismo contenido y mismo modelo. */
export class ExactMatchHandler implements CacheLookupHandler {
  constructor(private readonly cache: AnswerCache) {}

  async handle(ctx: LookupContext, found: CacheFound | null): Promise<CacheFound | null> {
    if (found) return found;
    const hit = await this.cache.get(ctx.key);
    return hit ? { hit, match: { kind: 'exact' } } : null;
  }
}

/** 2) Una pregunta guardada con significado parecido y las mismas cifras y términos del catálogo. */
export class SemanticMatchHandler implements CacheLookupHandler {
  private readonly logger = new Logger(SemanticMatchHandler.name);

  constructor(private readonly cache: AnswerCache) {}

  async handle(ctx: LookupContext, found: CacheFound | null): Promise<CacheFound | null> {
    if (found || !this.cache.semanticEnabled) return found;
    const embedding = await ctx.embedQuestion();
    const candidates = await this.cache.similar(ctx.projectId, ctx.semantic, ctx.semantic.variant, embedding);
    if (candidates.length === 0) return null;
    const vocabulary = await ctx.knowledge.catalogVocabulary(ctx.projectId, ctx.semantic.version);
    for (const c of candidates) {
      if (!sameIntent(ctx.question, c.question, vocabulary)) {
        this.logger.log(`Caché por significado descartada (${c.similarity.toFixed(3)}): "${c.question}" ≠ "${ctx.question}"`);
        continue;
      }
      const hit = await this.cache.get(c.cache_key);
      if (hit) {
        this.logger.log(`Caché por significado (${c.similarity.toFixed(3)}): "${ctx.question}" → "${c.question}"`);
        return { hit, match: { kind: 'semantic', question: c.question, similarity: Number(c.similarity.toFixed(3)) } };
      }
    }
    return null;
  }
}

/**
 * 3) La misma pregunta ya respondida por el modelo principal en el otro canal
 * (chat interno / widget): se reutiliza en vez de generar de nuevo o de quedarse
 * con una respuesta provisional del respaldo.
 */
export class SiblingVariantHandler implements CacheLookupHandler {
  private readonly logger = new Logger(SiblingVariantHandler.name);

  constructor(private readonly cache: AnswerCache) {}

  async handle(ctx: LookupContext, found: CacheFound | null): Promise<CacheFound | null> {
    if (found && !isProvisional(found)) return found;
    const embedding = await ctx.embedQuestion();
    const normalized = normalizeQuestion(ctx.question);
    const candidates = await this.cache.similar(ctx.projectId, ctx.semantic, null, embedding, 0.97);
    for (const c of candidates) {
      if (c.variant === ctx.semantic.variant || normalizeQuestion(c.question) !== normalized) continue;
      const hit = await this.cache.get(c.cache_key);
      if (hit && !hit.modelInfo?.fallback) {
        this.logger.log(`Caché de otra variante (${c.variant}): "${ctx.question}"`);
        return { hit, match: { kind: 'exact' } };
      }
    }
    return found;
  }
}

/** Ejecuta los eslabones en orden. */
export class CacheLookupChain {
  constructor(private readonly handlers: CacheLookupHandler[]) {}

  static standard(cache: AnswerCache): CacheLookupChain {
    return new CacheLookupChain([new ExactMatchHandler(cache), new SemanticMatchHandler(cache), new SiblingVariantHandler(cache)]);
  }

  async find(ctx: LookupContext): Promise<CacheFound | null> {
    let found: CacheFound | null = null;
    for (const handler of this.handlers) found = await handler.handle(ctx, found);
    return found;
  }
}
