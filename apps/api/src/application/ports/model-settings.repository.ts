import type { LlmProvider, ModelSettings } from '../../domain/models/catalog';

export interface ProviderCredential {
  /** El asistente tiene guardada una clave de este proveedor. */
  configured: boolean;
  last4: string | null;
  updatedAt: string | null;
}

/** Puerto de salida (Repository): configuración de modelos y estado de las claves de cada asistente. */
export interface ModelSettingsRepository {
  find(projectId: string): Promise<ModelSettings>;
  credentials(projectId: string): Promise<Record<LlmProvider, ProviderCredential>>;
}

export const MODEL_SETTINGS_REPOSITORY = Symbol('MODEL_SETTINGS_REPOSITORY');
