import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseAuthGuard } from './auth/auth.guard';
import { CompaniesController } from './companies/companies.controller';
import { HealthController } from './health.controller';
import { ProjectsController } from './projects/projects.controller';
import { CoreModule } from './supabase/supabase.module';

@Module({
  imports: [CoreModule],
  controllers: [HealthController, CompaniesController, ProjectsController],
  providers: [{ provide: APP_GUARD, useClass: SupabaseAuthGuard }],
})
export class AppModule {}
