import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { geminiClient } from '../chat/gemini.service';
import { SupabaseService } from '../supabase/supabase.service';

/** Cuánto se recuerda en memoria la clave descifrada antes de volver a leer el Vault. */
const CACHE_TTL_MS = 5 * 60_000;

/**
 * Claves de Gemini propias de cada empresa. Se guardan cifradas en Supabase
 * Vault; aquí solo se leen (con service_role) para usarlas en el servidor,
 * nunca se devuelven al navegador.
 */
@Injectable()
export class CompanyKeysService {
  private readonly logger = new Logger(CompanyKeysService.name);
  private readonly cache = new Map<string, { key: string | null; expires: number }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
  ) {}

  /** Clave de la empresa, o null si no configuró una (se usa la de la plataforma). */
  async getGeminiKey(companyId: string): Promise<string | null> {
    const cached = this.cache.get(companyId);
    if (cached && cached.expires > Date.now()) return cached.key;

    const { data, error } = await this.supabase.admin.rpc('get_company_gemini_key', { p_company_id: companyId });
    if (error) {
      // Si el Vault no responde, se sigue con la clave de la plataforma en vez de fallar.
      this.logger.warn(`No se pudo leer la clave de la empresa ${companyId}: ${error.message}`);
      return null;
    }
    const key = typeof data === 'string' && data ? data : null;
    this.cache.set(companyId, { key, expires: Date.now() + CACHE_TTL_MS });
    return key;
  }

  invalidate(companyId: string): void {
    this.cache.delete(companyId);
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
