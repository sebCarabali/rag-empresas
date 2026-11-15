import { Injectable } from '@nestjs/common';
import type {
  AccessPolicy,
  CompanyRepository,
  CompanyRole,
  DataScope,
  Membership,
  ProjectRef,
  ProjectRepository,
  ProjectRow,
  ReindexState,
} from '../../application/ports';
import { SupabaseService } from '../supabase/supabase.service';
import { check, unwrap } from './supabase-result';

const PROJECT_COLUMNS = 'id, company_id, name, description, created_at, updated_at';
const REINDEX_COLUMNS =
  'embedding_model, reindex_status, reindex_done, reindex_total, reindex_started_at, reindex_finished_at, reindex_error';

/** Adaptador (Repository) sobre la tabla projects. */
@Injectable()
export class SupabaseProjectRepository implements ProjectRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async list(scope: DataScope, companyId: string): Promise<ProjectRow[]> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('projects')
        .select(PROJECT_COLUMNS)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false }),
    ) as ProjectRow[];
  }

  async create(scope: DataScope, input: { companyId: string; name: string; description: string | null }): Promise<ProjectRow> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('projects')
        .insert({ company_id: input.companyId, name: input.name, description: input.description })
        .select(PROJECT_COLUMNS)
        .single(),
    ) as ProjectRow;
  }

  async get(scope: DataScope, id: string): Promise<ProjectRow> {
    return unwrap(
      await this.supabase.client(scope).from('projects').select(PROJECT_COLUMNS).eq('id', id).single(),
      'Proyecto no encontrado',
    ) as ProjectRow;
  }

  async update(scope: DataScope, id: string, patch: { name?: string; description?: string }): Promise<ProjectRow> {
    return unwrap(
      await this.supabase.client(scope).from('projects').update(patch).eq('id', id).select(PROJECT_COLUMNS).single(),
      'Proyecto no encontrado o sin permiso',
    ) as ProjectRow;
  }

  async delete(scope: DataScope, id: string): Promise<void> {
    unwrap(
      await this.supabase.client(scope).from('projects').delete().eq('id', id).select('id').single(),
      'Proyecto no encontrado o sin permiso',
    );
  }

  async ref(scope: DataScope, id: string): Promise<ProjectRef> {
    const row = unwrap(
      await this.supabase.client(scope).from('projects').select('id, company_id').eq('id', id).single(),
      'Proyecto no encontrado',
    );
    return { id: row.id as string, companyId: row.company_id as string };
  }

  async findRef(id: string): Promise<ProjectRef | null> {
    const { data, error } = await this.supabase.admin.from('projects').select('id, company_id').eq('id', id).maybeSingle();
    check(error);
    return data ? { id: data.id as string, companyId: data.company_id as string } : null;
  }

  async reindexState(id: string): Promise<ReindexState> {
    const data = unwrap(
      await this.supabase.admin.from('projects').select(REINDEX_COLUMNS).eq('id', id).single(),
      'Proyecto no encontrado',
    );
    return {
      embeddingModel: data.embedding_model,
      status: data.reindex_status,
      done: data.reindex_done,
      total: data.reindex_total,
      startedAt: data.reindex_started_at,
      finishedAt: data.reindex_finished_at,
      error: data.reindex_error,
    };
  }

  async claimReindex(id: string, total: number, staleBefore: Date): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('projects')
      .update({
        reindex_status: 'running',
        reindex_done: 0,
        reindex_total: total,
        reindex_started_at: new Date().toISOString(),
        reindex_finished_at: null,
        reindex_error: null,
      })
      .eq('id', id)
      .or(`reindex_status.is.null,reindex_status.neq.running,reindex_started_at.lt.${staleBefore.toISOString()}`)
      .select('id');
    check(error);
    return Boolean(data?.length);
  }

  async saveReindexProgress(id: string, done: number): Promise<void> {
    check((await this.supabase.admin.from('projects').update({ reindex_done: done }).eq('id', id)).error);
  }

  async finishReindex(id: string, model: string, done: number): Promise<void> {
    const { error } = await this.supabase.admin
      .from('projects')
      .update({ embedding_model: model, reindex_status: 'done', reindex_done: done, reindex_finished_at: new Date().toISOString() })
      .eq('id', id);
    check(error);
  }

  async failReindex(id: string, message: string): Promise<void> {
    await this.supabase.admin
      .from('projects')
      .update({ reindex_status: 'failed', reindex_error: message.slice(0, 500), reindex_finished_at: new Date().toISOString() })
      .eq('id', id);
  }
}

/** Adaptador de AccessPolicy: función has_company_role de la base. */
@Injectable()
export class SupabaseAccessPolicy implements AccessPolicy {
  constructor(private readonly supabase: SupabaseService) {}

  async hasRole(scope: DataScope, companyId: string, roles: readonly CompanyRole[]): Promise<boolean> {
    const { data, error } = await this.supabase
      .client(scope)
      .rpc('has_company_role', { p_company_id: companyId, p_roles: [...roles] });
    check(error);
    return Boolean(data);
  }
}

/** Adaptador (Repository) sobre companies y company_members. */
@Injectable()
export class SupabaseCompanyRepository implements CompanyRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async memberships(scope: DataScope, userId: string): Promise<Membership[]> {
    const rows = unwrap(
      await this.supabase
        .client(scope)
        .from('company_members')
        .select('role, company:companies(id, name, created_at)')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
    ) as unknown as Array<{ role: CompanyRole; company: Omit<Membership, 'role'> }>;
    return rows.map((m) => ({ ...m.company, role: m.role }));
  }

  async create(scope: DataScope, name: string): Promise<Omit<Membership, 'role'>> {
    return unwrap(await this.supabase.client(scope).rpc('create_company', { p_name: name }).single()) as Omit<Membership, 'role'>;
  }
}
