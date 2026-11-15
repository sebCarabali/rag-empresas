import { Injectable } from '@nestjs/common';
import type {
  ApiKeyRepository,
  ApiKeyRow,
  DataScope,
  EnrichmentRepository,
  EnrichmentRow,
  ProjectRef,
  WarmQuestion,
  WarmRunRepository,
  WarmRunRow,
  WarmRunStatus,
} from '../../application/ports';
import { NotFoundError } from '../../domain/errors';
import { SupabaseService } from '../supabase/supabase.service';
import { check, unwrap } from './supabase-result';

/** Adaptador (Repository) sobre catalog_enrichments. */
@Injectable()
export class SupabaseEnrichmentRepository implements EnrichmentRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async list(scope: DataScope, projectId: string): Promise<EnrichmentRow[]> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('catalog_enrichments')
        .select('id, field, value, description, sources, status, error, updated_at')
        .eq('project_id', projectId)
        .order('field')
        .order('value'),
    ) as EnrichmentRow[];
  }

  async retryFailed(projectId: string): Promise<void> {
    await this.supabase.admin
      .from('catalog_enrichments')
      .update({ status: 'pending', error: null })
      .eq('project_id', projectId)
      .eq('status', 'failed');
  }

  async resetAll(projectId: string): Promise<void> {
    await this.supabase.admin.from('catalog_enrichments').update({ status: 'pending', error: null }).eq('project_id', projectId);
  }

  async registerValues(project: ProjectRef, values: Array<{ field: string; value: string }>): Promise<void> {
    const { error } = await this.supabase.admin.from('catalog_enrichments').upsert(
      values.map((v) => ({ company_id: project.companyId, project_id: project.id, field: v.field, value: v.value })),
      { onConflict: 'project_id,field,value', ignoreDuplicates: true },
    );
    if (error) throw new Error(`catalog_enrichments: ${error.message}`);
  }

  async pending(projectId: string) {
    const { data } = await this.supabase.admin
      .from('catalog_enrichments')
      .select('id, field, value')
      .eq('project_id', projectId)
      .eq('status', 'pending');
    return (data ?? []) as Array<Pick<EnrichmentRow, 'id' | 'field' | 'value'>>;
  }

  async markReady(
    id: string,
    result: { description: string; sources: Array<{ title: string; url: string }>; queries: string[]; model: string },
  ): Promise<void> {
    await this.supabase.admin
      .from('catalog_enrichments')
      .update({
        status: 'ready',
        description: result.description,
        sources: result.sources,
        search_queries: result.queries,
        model: result.model,
        error: null,
      })
      .eq('id', id);
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.supabase.admin.from('catalog_enrichments').update({ status: 'failed', error }).eq('id', id);
  }

  async failPending(projectId: string, error: string): Promise<void> {
    await this.supabase.admin
      .from('catalog_enrichments')
      .update({ status: 'failed', error })
      .eq('project_id', projectId)
      .eq('status', 'pending');
  }
}

const WARM_COLUMNS = 'id, status, trigger, total, done, generated, error, created_at, finished_at';

/** Adaptador (Repository) sobre cache_warm_runs. */
@Injectable()
export class SupabaseWarmRunRepository implements WarmRunRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async list(scope: DataScope, projectId: string, limit: number): Promise<WarmRunRow[]> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('cache_warm_runs')
        .select(WARM_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit),
    ) as WarmRunRow[];
  }

  async hasActive(projectId: string, since: Date): Promise<boolean> {
    const { data } = await this.supabase.admin
      .from('cache_warm_runs')
      .select('id')
      .eq('project_id', projectId)
      .in('status', ['queued', 'running'])
      .gte('created_at', since.toISOString())
      .limit(1);
    return Boolean(data?.length);
  }

  async create(project: ProjectRef, trigger: WarmRunRow['trigger']): Promise<WarmRunRow> {
    return unwrap(
      await this.supabase.admin
        .from('cache_warm_runs')
        .insert({ company_id: project.companyId, project_id: project.id, trigger })
        .select(WARM_COLUMNS)
        .single(),
    ) as WarmRunRow;
  }

  async find(runId: string) {
    const { data } = await this.supabase.admin
      .from('cache_warm_runs')
      .select('id, status, questions, done, generated')
      .eq('id', runId)
      .maybeSingle();
    return (data as { id: string; status: WarmRunStatus; questions: WarmQuestion[]; done: number; generated: number } | null) ?? null;
  }

  async start(runId: string, questions: WarmQuestion[]): Promise<void> {
    await this.supabase.admin.from('cache_warm_runs').update({ status: 'running', questions, total: questions.length }).eq('id', runId);
  }

  async saveProgress(runId: string, done: number, generated: number): Promise<void> {
    await this.supabase.admin.from('cache_warm_runs').update({ done, generated }).eq('id', runId);
  }

  async finish(runId: string, done: number, generated: number): Promise<void> {
    await this.supabase.admin
      .from('cache_warm_runs')
      .update({ status: 'done', done, generated, finished_at: new Date().toISOString() })
      .eq('id', runId);
  }

  async fail(runId: string, message: string): Promise<void> {
    await this.supabase.admin
      .from('cache_warm_runs')
      .update({ status: 'failed', error: message.slice(0, 1000), finished_at: new Date().toISOString() })
      .eq('id', runId);
  }
}

const KEY_COLUMNS = 'id, name, prefix, last4, created_at, last_used_at, revoked_at';

/** Adaptador (Repository) sobre api_keys. Solo se guarda el hash de cada clave. */
@Injectable()
export class SupabaseApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async list(scope: DataScope, projectId: string): Promise<ApiKeyRow[]> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('api_keys')
        .select(KEY_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
    ) as ApiKeyRow[];
  }

  async countActive(projectId: string): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('revoked_at', null);
    check(error);
    return count ?? 0;
  }

  async create(input: {
    companyId: string;
    projectId: string;
    name: string;
    prefix: string;
    last4: string;
    hash: string;
    createdBy: string;
  }): Promise<ApiKeyRow> {
    return unwrap(
      await this.supabase.admin
        .from('api_keys')
        .insert({
          company_id: input.companyId,
          project_id: input.projectId,
          name: input.name,
          prefix: input.prefix,
          last4: input.last4,
          key_hash: input.hash,
          created_by: input.createdBy,
        })
        .select(KEY_COLUMNS)
        .single(),
    ) as ApiKeyRow;
  }

  async revoke(projectId: string, keyId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyId)
      .eq('project_id', projectId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    check(error);
    if (!data) throw new NotFoundError('Clave no encontrada o ya revocada');
  }

  async findByHash(hash: string) {
    const { data } = await this.supabase.admin
      .from('api_keys')
      .select('id, company_id, project_id, revoked_at')
      .eq('key_hash', hash)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id as string,
      companyId: data.company_id as string,
      projectId: data.project_id as string,
      revoked: Boolean(data.revoked_at),
    };
  }

  touch(id: string): void {
    void this.supabase.admin
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', id)
      .then(() => undefined);
  }
}
