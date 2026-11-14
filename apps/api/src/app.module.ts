import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseAuthGuard } from './auth/auth.guard';
import { ChatController } from './chat/chat.controller';
import { ChatbotsController } from './chatbots/chatbots.controller';
import { WidgetController } from './chatbots/widget.controller';
import { CompaniesController } from './companies/companies.controller';
import { DocumentsController } from './documents/documents.controller';
import { EnrichmentsController } from './enrichment/enrichments.controller';
import { EvalsController } from './evals/evals.controller';
import { FeedbackController } from './chat/feedback.controller';
import { HealthController } from './health.controller';
import { IngestionModule } from './ingestion/ingestion.module';
import { ProjectsController } from './projects/projects.controller';
import { CoreModule } from './supabase/supabase.module';

@Module({
  imports: [CoreModule, IngestionModule],
  controllers: [HealthController, CompaniesController, ProjectsController, DocumentsController, ChatController, EnrichmentsController, ChatbotsController, WidgetController, EvalsController, FeedbackController],
  providers: [{ provide: APP_GUARD, useClass: SupabaseAuthGuard }],
})
export class AppModule {}
