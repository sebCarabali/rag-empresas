import { Global, Module } from '@nestjs/common';
import { CompanyKeysService } from '../companies/company-keys.service';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from './supabase.service';
import { UsageService } from '../usage/usage.service';

@Global()
@Module({
  providers: [AppConfig, SupabaseService, CompanyKeysService, UsageService],
  exports: [AppConfig, SupabaseService, CompanyKeysService, UsageService],
})
export class CoreModule {}
