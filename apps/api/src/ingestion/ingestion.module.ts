import { Module } from '@nestjs/common';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { EnrichmentService } from '../enrichment/enrichment.service';
import { IngestionQueueService } from '../queue/ingestion-queue.service';
import { IngestionService } from './ingestion.service';

@Module({
  providers: [EmbeddingsService, IngestionService, IngestionQueueService, EnrichmentService],
  exports: [EmbeddingsService, IngestionService, IngestionQueueService, EnrichmentService],
})
export class IngestionModule {}
