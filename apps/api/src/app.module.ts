import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseAuthGuard } from './interfaces/http/auth/auth.guard';
import { ChatController } from './interfaces/http/chat/chat.controller';
import { ChatbotsController } from './interfaces/http/chatbots/chatbots.controller';
import { WidgetController } from './interfaces/http/chatbots/widget.controller';
import { CompaniesController } from './interfaces/http/companies/companies.controller';
import { DocumentsController } from './interfaces/http/documents/documents.controller';
import { EnrichmentsController } from './interfaces/http/enrichment/enrichments.controller';
import { EvalsController } from './interfaces/http/evals/evals.controller';
import { FeedbackController } from './interfaces/http/chat/feedback.controller';
import { UsageController } from './interfaces/http/usage/usage.controller';
import { ReindexController } from './interfaces/http/embeddings/reindex.controller';
import { ModelsController } from './interfaces/http/models/models.controller';
import { ApiKeysController } from './interfaces/http/api-keys/api-keys.controller';
import { PublicApiController } from './interfaces/http/api-keys/public-api.controller';
import { HealthController } from './interfaces/http/health.controller';
import { IngestionModule } from './composition/application.module';
import { ProjectsController } from './interfaces/http/projects/projects.controller';
import { CoreModule } from './composition/core.module';

@Module({
  imports: [CoreModule, IngestionModule],
  controllers: [HealthController, CompaniesController, ProjectsController, DocumentsController, ChatController, EnrichmentsController, ChatbotsController, WidgetController, EvalsController, FeedbackController, UsageController, ApiKeysController, PublicApiController, ReindexController, ModelsController],
  providers: [{ provide: APP_GUARD, useClass: SupabaseAuthGuard }],
})
export class AppModule {}
