import type { LlmProvider } from '../../domain/models/catalog';
import type { DataScope } from './data-scope';

/** Puerto de salida: lee las claves de API que la empresa guardó en el asistente (nunca las expone). */
export interface ProviderKeyReader {
  /** Clave del asistente del proyecto para el proveedor, o null si no la configuró. */
  getKey(projectId: string, provider: LlmProvider): Promise<string | null>;
  /** Como getKey, pero falla con MissingModelKeyError si no hay clave. */
  requireKey(projectId: string, provider: LlmProvider, purpose?: string): Promise<string>;
  /** Olvida lo que se tenga en memoria del proyecto (tras guardar o borrar una clave). */
  invalidate(projectId: string): void;
}

/** Puerto de salida: comprueba con el proveedor que una clave funcione. */
export interface ProviderKeyValidator {
  validate(provider: LlmProvider, apiKey: string): Promise<void>;
}

/** Puerto de salida: guarda o borra las claves del asistente en el almacén de secretos (solo owner/admin). */
export interface ProviderKeyWriter {
  save(scope: DataScope, projectId: string, provider: LlmProvider, apiKey: string): Promise<void>;
  remove(scope: DataScope, projectId: string, provider: LlmProvider): Promise<void>;
}

export const PROVIDER_KEY_WRITER = Symbol('PROVIDER_KEY_WRITER');
export const PROVIDER_KEY_READER = Symbol('PROVIDER_KEY_READER');
export const PROVIDER_KEY_VALIDATOR = Symbol('PROVIDER_KEY_VALIDATOR');
