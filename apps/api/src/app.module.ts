import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseAuthGuard } from './auth/auth.guard';
import { CompaniesController } from './companies/companies.controller';
import { DocumentsController } from './documents/documents.controller';
import { HealthController } from './health.controller';
import { IngestionModule } from './ingestion/ingestion.module';
import { ProjectsController } from './projects/projects.controller';
import { CoreModule } from './supabase/supabase.module';

@Module({
  imports: [CoreModule, IngestionModule],
  controllers: [HealthController, CompaniesController, ProjectsController, DocumentsController],
  providers: [{ provide: APP_GUARD, useClass: SupabaseAuthGuard }],
})
export class AppModule {}
