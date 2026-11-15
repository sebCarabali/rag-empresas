import { Injectable } from '@nestjs/common';
import { PROVIDER_LABEL, type LlmProvider } from '../../domain/models/catalog';
import { MissingModelKeyError } from '../../domain/llm/llm';
import type { ProviderKeyReader } from '../../application/ports';
import { SupabaseService } from '../supabase/supabase.service';

/** Cuánto se recuerda en memoria la clave descifrada antes de volver a leer el Vault. */
const CACHE_TTL_MS = 5 * 60_000;

/**
 * Adaptador del puerto ProviderKeyReader sobre Supabase Vault: lee (con
 * service_role) las claves que la empresa guardó en cada asistente. Nunca las
 * devuelve al navegador.
 */
@Injectable()
export class VaultProviderKeyStore implements ProviderKeyReader {
  private readonly cache = new Map<string, { key: string | null; expires: number }>();

  constructor(private readonly supabase: SupabaseService) {}

  async getKey(projectId: string, provider: LlmProvider): Promise<string | null> {
    const id = `${projectId}:${provider}`;
    const cached = this.cache.get(id);
    if (cached && cached.expires > Date.now()) return cached.key;

    const { data, error } = await this.supabase.admin.rpc('get_project_provider_key', {
      p_project_id: projectId,
      p_provider: provider,
    });
    if (error) throw new Error(`No se pudo leer la clave de ${PROVIDER_LABEL[provider]}: ${error.message}`);
    const key = typeof data === 'string' && data ? data : null;
    if (this.cache.size > 1000) this.cache.clear();
    this.cache.set(id, { key, expires: Date.now() + CACHE_TTL_MS });
    return key;
  }

  async requireKey(projectId: string, provider: LlmProvider, purpose?: string): Promise<string> {
    const key = await this.getKey(projectId, provider);
    if (!key) throw new MissingModelKeyError(provider, purpose);
    return key;
  }

  invalidate(projectId: string): void {
    for (const id of this.cache.keys()) if (id.startsWith(`${projectId}:`)) this.cache.delete(id);
  }
}
