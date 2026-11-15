import { Module } from '@nestjs/common';
import { ApiKeysService } from '../application/api-keys/api-keys.service';
import { CacheWarmService } from '../application/cache/cache-warm.service';
import { AnswerCacheService } from '../infrastructure/persistence/supabase-answer-cache';
import { ChatEngineService } from '../application/chat/chat-engine.service';
import { GeminiService } from '../infrastructure/llm/gemini-chat-model';
import { GroqService } from '../infrastructure/llm/openai-compatible-chat-model';
import { LlmService } from '../application/llm/llm.service';
import { ChatbotsService } from '../application/chatbots/chatbots.service';
import { EmbeddingsService } from '../application/embeddings/embeddings.service';
import { ReindexService } from '../application/embeddings/reindex.service';
import { EnrichmentService } from '../application/enrichment/enrichment.service';
import { EvalRunnerService } from '../application/evals/eval-runner.service';
import { IngestionQueueService } from '../infrastructure/queue/ingestion-queue.service';
import { RerankerService } from '../infrastructure/rerank/transformers-reranker';
import { ModelSettingsService } from '../application/models/model-settings.service';
import { IngestionService } from '../application/ingestion/ingestion.service';
import { OcrService } from '../infrastructure/ocr/gemini-ocr.service';

/**
 * Servicios que comparten la API y el worker de la cola: ingesta, OCR,
 * enriquecimiento y el motor del chat (lo usan las pruebas de calidad).
 */
const SHARED = [
  EmbeddingsService,
  RerankerService,
  ModelSettingsService,
  ReindexService,
  IngestionService,
  IngestionQueueService,
  EnrichmentService,
  OcrService,
  GeminiService,
  GroqService,
  LlmService,
  AnswerCacheService,
  ChatEngineService,
  ChatbotsService,
  EvalRunnerService,
  CacheWarmService,
  ApiKeysService,
];

@Module({ providers: SHARED, exports: SHARED })
export class IngestionModule {}
