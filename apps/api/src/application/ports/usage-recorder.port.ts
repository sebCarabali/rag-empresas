import type { LlmProvider } from '../../domain/models/catalog';
import type { TokenUsage } from '../../domain/llm/llm';

export type UsageChannel = 'app' | 'widget' | 'api' | 'eval' | 'warm' | 'ocr' | 'enrich';

export interface UsageEvent {
  companyId: string;
  projectId?: string | null;
  channel: UsageChannel;
  cacheMatch?: 'exact' | 'semantic' | null;
  provider?: LlmProvider | null;
  model?: string | null;
  fallback?: boolean;
  keyOwner?: 'company' | 'platform' | null;
  usage?: TokenUsage | null;
  durationMs?: number;
}

/** Puerto de salida: registra el uso para el panel de gastos. Nunca debe hacer fallar una respuesta. */
export interface UsageRecorder {
  record(event: UsageEvent): Promise<void>;
}

export const USAGE_RECORDER = Symbol('USAGE_RECORDER');
