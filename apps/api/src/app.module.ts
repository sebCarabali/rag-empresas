import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseAuthGuard } from './auth/auth.guard';
import { AnswerCacheService } from './chat/answer-cache.service';
import { ChatController } from './chat/chat.controller';
import { ChatEngineService } from './chat/chat-engine.service';
import { ChatbotsController } from './chatbots/chatbots.controller';
import { ChatbotsService } from './chatbots/chatbots.service';
import { WidgetController } from './chatbots/widget.controller';
import { GeminiService } from './chat/gemini.service';
import { GroqService } from './chat/groq.service';
import { LlmService } from './chat/llm.service';
import { CompaniesController } from './companies/companies.controller';
import { DocumentsController } from './documents/documents.controller';
import { EnrichmentsController } from './enrichment/enrichments.controller';
import { HealthController } from './health.controller';
import { IngestionModule } from './ingestion/ingestion.module';
import { ProjectsController } from './projects/projects.controller';
import { CoreModule } from './supabase/supabase.module';

@Module({
  imports: [CoreModule, IngestionModule],
  controllers: [HealthController, CompaniesController, ProjectsController, DocumentsController, ChatController, EnrichmentsController, ChatbotsController, WidgetController],
  providers: [{ provide: APP_GUARD, useClass: SupabaseAuthGuard }, GeminiService, GroqService, LlmService, AnswerCacheService, ChatEngineService, ChatbotsService],
})
export class AppModule {}
