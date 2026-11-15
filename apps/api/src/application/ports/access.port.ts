import type { DataScope } from './data-scope';

export type CompanyRole = 'owner' | 'admin' | 'editor' | 'viewer';

export const ADMIN_ROLES: readonly CompanyRole[] = ['owner', 'admin'];
export const EDITOR_ROLES: readonly CompanyRole[] = ['owner', 'admin', 'editor'];

/** Puerto de salida: rol del usuario en una empresa. */
export interface AccessPolicy {
  hasRole(scope: DataScope, companyId: string, roles: readonly CompanyRole[]): Promise<boolean>;
}

export interface Membership {
  id: string;
  name: string;
  created_at: string;
  role: CompanyRole;
}

/** Puerto de salida (Repository): empresas y membresías del usuario. */
export interface CompanyRepository {
  memberships(scope: DataScope, userId: string): Promise<Membership[]>;
  /** Crea la empresa; quien la crea queda como owner. */
  create(scope: DataScope, name: string): Promise<Omit<Membership, 'role'>>;
}

export const ACCESS_POLICY = Symbol('ACCESS_POLICY');
export const COMPANY_REPOSITORY = Symbol('COMPANY_REPOSITORY');
