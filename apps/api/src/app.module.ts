import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseAuthGuard } from './auth/auth.guard';
import { ChatController } from './chat/chat.controller';
import { GeminiService } from './chat/gemini.service';
import { CompaniesController } from './companies/companies.controller';
import { DocumentsController } from './documents/documents.controller';
import { HealthController } from './health.controller';
import { IngestionModule } from './ingestion/ingestion.module';
import { ProjectsController } from './projects/projects.controller';
import { CoreModule } from './supabase/supabase.module';

@Module({
  imports: [CoreModule, IngestionModule],
  controllers: [HealthController, CompaniesController, ProjectsController, DocumentsController, ChatController],
  providers: [{ provide: APP_GUARD, useClass: SupabaseAuthGuard }, GeminiService],
})
export class AppModule {}
