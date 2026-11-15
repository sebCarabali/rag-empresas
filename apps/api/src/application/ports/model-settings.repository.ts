import type { LlmProvider, ModelSettings } from '../../domain/models/catalog';
import type { DataScope } from './data-scope';
import type { ProjectRef } from './projects.repository';

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
  /** Guarda la configuración (crea el asistente si no existe). ForbiddenError si el usuario no puede. */
  save(scope: DataScope, project: ProjectRef, settings: ModelSettings): Promise<void>;
}

export const MODEL_SETTINGS_REPOSITORY = Symbol('MODEL_SETTINGS_REPOSITORY');
