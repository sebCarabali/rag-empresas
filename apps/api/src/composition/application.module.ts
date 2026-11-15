import { Module, type Provider } from '@nestjs/common';
import { ApiKeysService } from '../application/api-keys/api-keys.service';
import { CacheWarmService } from '../application/cache/cache-warm.service';
import { ChatEngineService } from '../application/chat/chat-engine.service';
import { ChatbotsService } from '../application/chatbots/chatbots.service';
import { EmbeddingsService } from '../application/embeddings/embeddings.service';
import { ReindexService } from '../application/embeddings/reindex.service';
import { EnrichmentService } from '../application/enrichment/enrichment.service';
import { EvalRunnerService } from '../application/evals/eval-runner.service';
import { IngestionService } from '../application/ingestion/ingestion.service';
import { ChatModelRegistry } from '../application/llm/chat-model-registry';
import { LlmService } from '../application/llm/llm.service';
import { ModelSettingsService } from '../application/models/model-settings.service';
import {
  ANSWER_CACHE,
  CHAT_MODELS,
  DOCUMENT_READER,
  EMBEDDING_BACKENDS,
  JOB_QUEUE,
  KNOWLEDGE_BASE_FACTORY,
  MODEL_SETTINGS_REPOSITORY,
  RERANKER,
  TEXT_RECOGNIZER,
  WEB_RESEARCHER,
} from '../application/ports';
import { GeminiWebResearcher } from '../infrastructure/enrichment/gemini-web-researcher';
import { FileDocumentReader } from '../infrastructure/extraction/file-document-reader';
import { GeminiEmbeddingBackend } from '../infrastructure/embeddings/gemini-embedding.backend';
import { LocalE5EmbeddingBackend } from '../infrastructure/embeddings/local-e5-embedding.backend';
import { OpenAiCompatibleEmbeddingBackend } from '../infrastructure/embeddings/openai-compatible-embedding.backend';
import { GeminiChatModel } from '../infrastructure/llm/gemini-chat-model';
import { OpenAiCompatibleChatModel } from '../infrastructure/llm/openai-compatible-chat-model';
import { GROQ_DIALECT, MISTRAL_DIALECT, OPENAI_DIALECT } from '../infrastructure/llm/openai-dialects';
import { GeminiOcrService } from '../infrastructure/ocr/gemini-ocr.service';
import { SupabaseAnswerCache } from '../infrastructure/persistence/supabase-answer-cache';
import { SupabaseKnowledgeBaseFactory } from '../infrastructure/persistence/supabase-knowledge-base';
import { SupabaseModelSettingsRepository } from '../infrastructure/persistence/supabase-model-settings.repository';
import { IngestionQueueService } from '../infrastructure/queue/ingestion-queue.service';
import { TransformersReranker } from '../infrastructure/rerank/transformers-reranker';

/**
 * Adaptadores de salida enlazados a sus puertos. Para agregar un proveedor de
 * modelos basta con registrar aquí su adaptador (o su dialecto, si su API es
 * compatible con OpenAI): los casos de uso no cambian.
 */
const ADAPTERS: Provider[] = [
  GeminiChatModel,
  {
    provide: CHAT_MODELS,
    inject: [GeminiChatModel],
    useFactory: (gemini: GeminiChatModel) => [
      gemini,
      new OpenAiCompatibleChatModel(GROQ_DIALECT),
      new OpenAiCompatibleChatModel(OPENAI_DIALECT),
      new OpenAiCompatibleChatModel(MISTRAL_DIALECT),
    ],
  },
  LocalE5EmbeddingBackend,
  GeminiEmbeddingBackend,
  {
    provide: EMBEDDING_BACKENDS,
    inject: [LocalE5EmbeddingBackend, GeminiEmbeddingBackend],
    useFactory: (local: LocalE5EmbeddingBackend, gemini: GeminiEmbeddingBackend) => [
      local,
      gemini,
      new OpenAiCompatibleEmbeddingBackend({ ...OPENAI_DIALECT, provider: 'openai' }),
      new OpenAiCompatibleEmbeddingBackend({ ...MISTRAL_DIALECT, provider: 'mistral' }),
    ],
  },
  { provide: RERANKER, useClass: TransformersReranker },
  { provide: ANSWER_CACHE, useClass: SupabaseAnswerCache },
  { provide: KNOWLEDGE_BASE_FACTORY, useClass: SupabaseKnowledgeBaseFactory },
  { provide: MODEL_SETTINGS_REPOSITORY, useClass: SupabaseModelSettingsRepository },
  { provide: TEXT_RECOGNIZER, useClass: GeminiOcrService },
  { provide: DOCUMENT_READER, useClass: FileDocumentReader },
  { provide: WEB_RESEARCHER, useClass: GeminiWebResearcher },
  IngestionQueueService,
  { provide: JOB_QUEUE, useExisting: IngestionQueueService },
];

/** Casos de uso y servicios de aplicación. */
const USE_CASES: Provider[] = [
  ChatModelRegistry,
  LlmService,
  EmbeddingsService,
  ModelSettingsService,
  ReindexService,
  IngestionService,
  EnrichmentService,
  ChatEngineService,
  ChatbotsService,
  EvalRunnerService,
  CacheWarmService,
  ApiKeysService,
];

const EXPORTED = [...USE_CASES, IngestionQueueService, JOB_QUEUE, RERANKER, ANSWER_CACHE, MODEL_SETTINGS_REPOSITORY];

/**
 * Raíz de composición de la aplicación (la usan la API HTTP y el worker de la
 * cola): enlaza cada puerto con su adaptador.
 */
@Module({ providers: [...ADAPTERS, ...USE_CASES], exports: EXPORTED })
export class ApplicationModule {}
