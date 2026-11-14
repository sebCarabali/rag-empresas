import { Global, Module } from '@nestjs/common';
import { CompanyKeysService } from '../companies/company-keys.service';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [AppConfig, SupabaseService, CompanyKeysService],
  exports: [AppConfig, SupabaseService, CompanyKeysService],
})
export class CoreModule {}
