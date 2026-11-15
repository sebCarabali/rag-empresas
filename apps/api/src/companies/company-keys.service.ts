import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { geminiClient } from '../chat/gemini.service';
import { OPENAI_COMPATIBLE_BASE, type LlmProvider } from '../models/catalog';
import { SupabaseService } from '../supabase/supabase.service';

/** Cuánto se recuerda en memoria la clave descifrada antes de volver a leer el Vault. */
const CACHE_TTL_MS = 5 * 60_000;

/**
 * Claves propias de cada empresa (Gemini, OpenAI, Groq). Se guardan cifradas
 * en Supabase Vault; aquí solo se leen (con service_role) para usarlas en el
 * servidor, nunca se devuelven al navegador.
 */
@Injectable()
export class CompanyKeysService {
  private readonly logger = new Logger(CompanyKeysService.name);
  private readonly cache = new Map<string, { key: string | null; expires: number }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
  ) {}

  /** Clave de la empresa para el proveedor, o null si no configuró una. */
  async getKey(companyId: string, provider: LlmProvider): Promise<string | null> {
    const id = `${companyId}:${provider}`;
    const cached = this.cache.get(id);
    if (cached && cached.expires > Date.now()) return cached.key;

    const { data, error } = await this.supabase.admin.rpc('get_company_provider_key', {
      p_company_id: companyId,
      p_provider: provider,
    });
    if (error) {
      // Si el Vault no responde, se sigue con la clave de la plataforma en vez de fallar.
      this.logger.warn(`No se pudo leer la clave de ${provider} de la empresa ${companyId}: ${error.message}`);
      return null;
    }
    const key = typeof data === 'string' && data ? data : null;
    this.cache.set(id, { key, expires: Date.now() + CACHE_TTL_MS });
    return key;
  }

  /** Clave de Gemini de la empresa, o null (se usa la de la plataforma). */
  getGeminiKey(companyId: string): Promise<string | null> {
    return this.getKey(companyId, 'gemini');
  }

  /** Clave de la plataforma para el proveedor ('' si no hay). */
  platformKey(provider: LlmProvider): string {
    if (provider === 'gemini') return this.config.geminiApiKey;
    if (provider === 'groq') return this.config.groqApiKey;
    return this.config.openaiApiKey;
  }

  invalidate(companyId: string): void {
    for (const id of this.cache.keys()) if (id.startsWith(`${companyId}:`)) this.cache.delete(id);
  }

  /** Comprueba que la clave funcione antes de guardarla. */
  async validateKey(provider: LlmProvider, apiKey: string): Promise<void> {
    if (provider === 'gemini') return this.validateGeminiKey(apiKey);
    const label = provider === 'openai' ? 'OpenAI' : 'Groq';
    let res: Response;
    try {
      res = await fetch(`${OPENAI_COMPATIBLE_BASE[provider]}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new BadRequestException(`No se pudo verificar la clave con ${label}: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new BadRequestException(`${label} rechazó la clave: revisa que esté completa y activa.`);
    }
    if (!res.ok) throw new BadRequestException(`No se pudo verificar la clave con ${label} (error ${res.status}).`);
  }

  /** Comprueba que la clave funcione con el modelo configurado antes de guardarla. */
  async validateGeminiKey(apiKey: string): Promise<void> {
    try {
      await geminiClient(apiKey).models.get({ model: this.config.geminiModel });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (/api key|401|403|permission|invalid/i.test(msg)) {
        throw new BadRequestException('Gemini rechazó la clave: revisa que esté completa y activa.');
      }
      if (/404|not found/i.test(msg)) {
        throw new BadRequestException(`La clave funciona, pero no tiene acceso al modelo ${this.config.geminiModel}.`);
      }
      throw new BadRequestException(`No se pudo verificar la clave con Gemini: ${msg.slice(0, 200)}`);
    }
  }
}
