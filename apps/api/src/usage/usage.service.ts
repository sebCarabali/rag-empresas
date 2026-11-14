import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from '../supabase/supabase.service';

export type UsageChannel = 'app' | 'widget' | 'api' | 'eval' | 'warm' | 'ocr' | 'enrich';

export interface TokenUsage {
  input: number;
  output: number;
}

export interface UsageEvent {
  companyId: string;
  projectId?: string | null;
  channel: UsageChannel;
  cacheMatch?: 'exact' | 'semantic' | null;
  provider?: 'gemini' | 'groq' | null;
  model?: string | null;
  fallback?: boolean;
  keyOwner?: 'company' | 'platform' | null;
  usage?: TokenUsage | null;
  durationMs?: number;
}

/** Lee los tokens de la metadata de uso de Gemini (el pensamiento se cobra como salida). */
export function geminiUsage(meta: unknown): TokenUsage | null {
  const m = meta as { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined;
  if (!m || m.promptTokenCount === undefined) return null;
  return { input: m.promptTokenCount ?? 0, output: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0) };
}

/**
 * Registro de uso para el panel (preguntas, caché, respaldo, tokens y gasto
 * estimado). Nunca bloquea ni hace fallar la respuesta.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
  ) {}

  cost(provider: 'gemini' | 'groq' | null | undefined, usage: TokenUsage | null | undefined): number {
    if (!provider || !usage) return 0;
    const price = this.config.prices[provider];
    return (usage.input * price.input + usage.output * price.output) / 1_000_000;
  }

  async record(event: UsageEvent): Promise<void> {
    try {
      // Una respuesta desde la caché no consume tokens.
      const usage = event.cacheMatch ? null : event.usage;
      const { error } = await this.supabase.admin.from('usage_events').insert({
        company_id: event.companyId,
        project_id: event.projectId ?? null,
        channel: event.channel,
        cache_match: event.cacheMatch ?? null,
        provider: event.provider ?? null,
        model: event.model ?? null,
        fallback: event.fallback ?? false,
        key_owner: event.keyOwner ?? null,
        input_tokens: usage?.input ?? 0,
        output_tokens: usage?.output ?? 0,
        cost_usd: Number(this.cost(event.provider, usage).toFixed(6)),
        duration_ms: event.durationMs ?? null,
      });
      if (error) this.logger.warn(`No se registró el uso: ${error.message}`);
    } catch (err) {
      this.logger.warn(`No se registró el uso: ${(err as Error).message}`);
    }
  }
}
