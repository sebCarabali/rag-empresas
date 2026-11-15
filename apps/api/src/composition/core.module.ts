import { Global, Module } from '@nestjs/common';
import { PROVIDER_KEY_READER, PROVIDER_KEY_VALIDATOR, USAGE_RECORDER } from '../application/ports';
import { AppConfig } from '../config/app-config';
import { SupabaseUsageRecorder } from '../infrastructure/persistence/supabase-usage-recorder';
import { HttpProviderKeyValidator } from '../infrastructure/secrets/http-provider-key-validator';
import { VaultProviderKeyStore } from '../infrastructure/secrets/vault-provider-key-store';
import { SupabaseService } from '../infrastructure/supabase/supabase.service';

/**
 * Raíz de composición, parte común (global): configuración, cliente de base de
 * datos y adaptadores que usan casi todos los casos de uso.
 */
@Global()
@Module({
  providers: [
    AppConfig,
    SupabaseService,
    { provide: PROVIDER_KEY_READER, useClass: VaultProviderKeyStore },
    { provide: PROVIDER_KEY_VALIDATOR, useClass: HttpProviderKeyValidator },
    { provide: USAGE_RECORDER, useClass: SupabaseUsageRecorder },
  ],
  exports: [AppConfig, SupabaseService, PROVIDER_KEY_READER, PROVIDER_KEY_VALIDATOR, USAGE_RECORDER],
})
export class CoreModule {}
