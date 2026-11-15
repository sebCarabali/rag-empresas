import { Global, Module, type Provider } from '@nestjs/common';
import {
  ACCESS_POLICY,
  ACCESS_TOKEN_VERIFIER,
  API_KEY_REPOSITORY,
  CATALOG_REPOSITORY,
  CHATBOT_REPOSITORY,
  CHUNK_REPOSITORY,
  COMPANY_REPOSITORY,
  CONVERSATION_REPOSITORY,
  DOCUMENT_REPOSITORY,
  ENRICHMENT_REPOSITORY,
  EVAL_REPOSITORY,
  FEEDBACK_REPOSITORY,
  FILE_STORAGE,
  MODEL_SETTINGS_REPOSITORY,
  PROJECT_REPOSITORY,
  PROVIDER_KEY_READER,
  PROVIDER_KEY_VALIDATOR,
  PROVIDER_KEY_WRITER,
  QUESTION_HISTORY,
  USAGE_RECORDER,
  USAGE_STATS,
  WARM_RUN_REPOSITORY,
  WIDGET_MESSAGE_REPOSITORY,
} from '../application/ports';
import { AppConfig } from '../config/app-config';
import {
  SupabaseApiKeyRepository,
  SupabaseEnrichmentRepository,
  SupabaseWarmRunRepository,
} from '../infrastructure/persistence/supabase-background.repositories';
import { SupabaseChatbotRepository } from '../infrastructure/persistence/supabase-chatbots.repository';
import {
  SupabaseConversationRepository,
  SupabaseFeedbackRepository,
  SupabaseQuestionHistory,
  SupabaseWidgetMessageRepository,
} from '../infrastructure/persistence/supabase-conversations.repository';
import {
  SupabaseCatalogRepository,
  SupabaseChunkRepository,
  SupabaseDocumentRepository,
} from '../infrastructure/persistence/supabase-documents.repository';
import { SupabaseEvalRepository } from '../infrastructure/persistence/supabase-evals.repository';
import { SupabaseModelSettingsRepository } from '../infrastructure/persistence/supabase-model-settings.repository';
import {
  SupabaseAccessPolicy,
  SupabaseCompanyRepository,
  SupabaseProjectRepository,
} from '../infrastructure/persistence/supabase-projects.repository';
import { SupabaseUsageRecorder, SupabaseUsageStats } from '../infrastructure/persistence/supabase-usage-recorder';
import { HttpProviderKeyValidator } from '../infrastructure/secrets/http-provider-key-validator';
import { VaultProviderKeyStore } from '../infrastructure/secrets/vault-provider-key-store';
import { SupabaseFileStorage } from '../infrastructure/storage/supabase-file-storage';
import { SupabaseService } from '../infrastructure/supabase/supabase.service';
import { SupabaseTokenVerifier } from '../infrastructure/supabase/supabase-token-verifier';

/** Puerto → adaptador de persistencia. Cambiar de base de datos es cambiar esta tabla. */
const PERSISTENCE: Provider[] = [
  { provide: PROJECT_REPOSITORY, useClass: SupabaseProjectRepository },
  { provide: ACCESS_POLICY, useClass: SupabaseAccessPolicy },
  { provide: COMPANY_REPOSITORY, useClass: SupabaseCompanyRepository },
  { provide: DOCUMENT_REPOSITORY, useClass: SupabaseDocumentRepository },
  { provide: CHUNK_REPOSITORY, useClass: SupabaseChunkRepository },
  { provide: CATALOG_REPOSITORY, useClass: SupabaseCatalogRepository },
  { provide: CHATBOT_REPOSITORY, useClass: SupabaseChatbotRepository },
  { provide: MODEL_SETTINGS_REPOSITORY, useClass: SupabaseModelSettingsRepository },
  { provide: CONVERSATION_REPOSITORY, useClass: SupabaseConversationRepository },
  { provide: FEEDBACK_REPOSITORY, useClass: SupabaseFeedbackRepository },
  { provide: WIDGET_MESSAGE_REPOSITORY, useClass: SupabaseWidgetMessageRepository },
  { provide: QUESTION_HISTORY, useClass: SupabaseQuestionHistory },
  { provide: EVAL_REPOSITORY, useClass: SupabaseEvalRepository },
  { provide: ENRICHMENT_REPOSITORY, useClass: SupabaseEnrichmentRepository },
  { provide: WARM_RUN_REPOSITORY, useClass: SupabaseWarmRunRepository },
  { provide: API_KEY_REPOSITORY, useClass: SupabaseApiKeyRepository },
  { provide: USAGE_STATS, useClass: SupabaseUsageStats },
  { provide: USAGE_RECORDER, useClass: SupabaseUsageRecorder },
  { provide: FILE_STORAGE, useClass: SupabaseFileStorage },
  VaultProviderKeyStore,
  { provide: PROVIDER_KEY_READER, useExisting: VaultProviderKeyStore },
  { provide: PROVIDER_KEY_WRITER, useExisting: VaultProviderKeyStore },
  { provide: PROVIDER_KEY_VALIDATOR, useClass: HttpProviderKeyValidator },
  { provide: ACCESS_TOKEN_VERIFIER, useClass: SupabaseTokenVerifier },
];

const TOKENS = PERSISTENCE.map((p) => (typeof p === 'function' ? p : p.provide));

/**
 * Raíz de composición, parte común (global): configuración y adaptadores de
 * persistencia, almacenamiento, secretos y sesión. Solo los adaptadores de
 * infrastructure/ usan SupabaseService; la aplicación y los controladores
 * dependen de los puertos.
 */
@Global()
@Module({
  providers: [AppConfig, SupabaseService, ...PERSISTENCE],
  exports: [AppConfig, SupabaseService, ...TOKENS],
})
export class CoreModule {}
