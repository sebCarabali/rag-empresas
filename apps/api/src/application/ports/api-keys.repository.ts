import type { DataScope } from './data-scope';

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Puerto de salida (Repository): claves secretas de API (solo se guarda su hash). */
export interface ApiKeyRepository {
  list(scope: DataScope, projectId: string): Promise<ApiKeyRow[]>;
  countActive(projectId: string): Promise<number>;
  create(input: {
    companyId: string;
    projectId: string;
    name: string;
    prefix: string;
    last4: string;
    hash: string;
    createdBy: string;
  }): Promise<ApiKeyRow>;
  /** NotFoundError si no existe o ya estaba revocada. */
  revoke(projectId: string, keyId: string): Promise<void>;
  findByHash(hash: string): Promise<{ id: string; companyId: string; projectId: string; revoked: boolean } | null>;
  /** Registra el último uso (no espera ni falla). */
  touch(id: string): void;
}

export const API_KEY_REPOSITORY = Symbol('API_KEY_REPOSITORY');
