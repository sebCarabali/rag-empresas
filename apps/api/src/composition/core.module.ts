import { Global, Module } from '@nestjs/common';
import { ProjectKeysService } from '../infrastructure/secrets/vault-provider-key-store';
import { AppConfig } from '../infrastructure/config/app-config';
import { SupabaseService } from '../infrastructure/supabase/supabase.service';
import { UsageService } from '../application/usage/usage.service';

@Global()
@Module({
  providers: [AppConfig, SupabaseService, ProjectKeysService, UsageService],
  exports: [AppConfig, SupabaseService, ProjectKeysService, UsageService],
})
export class CoreModule {}
