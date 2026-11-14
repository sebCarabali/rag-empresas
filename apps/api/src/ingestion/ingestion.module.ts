import { Module } from '@nestjs/common';
import { AnswerCacheService } from '../chat/answer-cache.service';
import { ChatEngineService } from '../chat/chat-engine.service';
import { GeminiService } from '../chat/gemini.service';
import { GroqService } from '../chat/groq.service';
import { LlmService } from '../chat/llm.service';
import { ChatbotsService } from '../chatbots/chatbots.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { EnrichmentService } from '../enrichment/enrichment.service';
import { EvalRunnerService } from '../evals/eval-runner.service';
import { IngestionQueueService } from '../queue/ingestion-queue.service';
import { IngestionService } from './ingestion.service';
import { OcrService } from './ocr.service';

/**
 * Servicios que comparten la API y el worker de la cola: ingesta, OCR,
 * enriquecimiento y el motor del chat (lo usan las pruebas de calidad).
 */
const SHARED = [
  EmbeddingsService,
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
];

@Module({ providers: SHARED, exports: SHARED })
export class IngestionModule {}
