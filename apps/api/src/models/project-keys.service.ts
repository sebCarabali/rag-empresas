import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { geminiClient } from '../chat/gemini.service';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from '../supabase/supabase.service';
import { OPENAI_COMPATIBLE_BASE, PROVIDER_LABEL, type LlmProvider } from './catalog';

/** Cuánto se recuerda en memoria la clave descifrada antes de volver a leer el Vault. */
const CACHE_TTL_MS = 5 * 60_000;

/** El asistente no tiene la clave que hace falta. El mensaje se puede mostrar al equipo de la empresa. */
export class MissingModelKeyError extends Error {
  constructor(
    readonly provider: LlmProvider,
    purpose = 'responder',
  ) {
    super(`Este asistente no tiene clave de ${PROVIDER_LABEL[provider]} para ${purpose}. Configúrala en Asistente y widget → Modelos.`);
  }
}

/**
 * Claves de API de cada asistente (Gemini, OpenAI, Groq). Las pone la empresa
 * en la configuración del asistente; la plataforma no aporta claves. Se
 * guardan cifradas en Supabase Vault; aquí solo se leen (service_role) para
 * usarlas en el servidor y nunca se devuelven al navegador.
 */
@Injectable()
export class ProjectKeysService {
  private readonly logger = new Logger(ProjectKeysService.name);
  private readonly cache = new Map<string, { key: string | null; expires: number }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
  ) {}

  /** Clave del asistente del proyecto para el proveedor, o null si no la configuró. */
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

  /** Como getKey, pero falla con un mensaje claro si no hay clave. */
  async requireKey(projectId: string, provider: LlmProvider, purpose?: string): Promise<string> {
    const key = await this.getKey(projectId, provider);
    if (!key) throw new MissingModelKeyError(provider, purpose);
    return key;
  }

  invalidate(projectId: string): void {
    for (const id of this.cache.keys()) if (id.startsWith(`${projectId}:`)) this.cache.delete(id);
  }

  /** Comprueba que la clave funcione antes de guardarla. */
  async validateKey(provider: LlmProvider, apiKey: string): Promise<void> {
    const label = PROVIDER_LABEL[provider];
    if (provider === 'gemini') {
      try {
        await geminiClient(apiKey).models.get({ model: this.config.geminiModel });
        return;
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        if (/api key|401|403|permission|invalid/i.test(msg)) {
          throw new BadRequestException('Gemini rechazó la clave: revisa que esté completa y activa.');
        }
        if (/404|not found/i.test(msg)) return; // la clave sirve; el modelo se elige aparte
        throw new BadRequestException(`No se pudo verificar la clave con Gemini: ${msg.slice(0, 200)}`);
      }
    }
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
}
