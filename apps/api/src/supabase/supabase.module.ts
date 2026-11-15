import { Global, Module } from '@nestjs/common';
import { ProjectKeysService } from '../models/project-keys.service';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from './supabase.service';
import { UsageService } from '../usage/usage.service';

@Global()
@Module({
  providers: [AppConfig, SupabaseService, ProjectKeysService, UsageService],
  exports: [AppConfig, SupabaseService, ProjectKeysService, UsageService],
})
export class CoreModule {}
