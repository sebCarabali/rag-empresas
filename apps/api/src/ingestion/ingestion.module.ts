import { Module } from '@nestjs/common';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { IngestionQueueService } from '../queue/ingestion-queue.service';
import { IngestionService } from './ingestion.service';

@Module({
  providers: [EmbeddingsService, IngestionService, IngestionQueueService],
  exports: [EmbeddingsService, IngestionService, IngestionQueueService],
})
export class IngestionModule {}
