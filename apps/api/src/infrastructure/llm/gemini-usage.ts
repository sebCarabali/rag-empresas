import type { TokenUsage } from '../../domain/llm/llm';

/** Lee los tokens de la metadata de uso de Gemini (el pensamiento se cobra como salida). */
export function geminiUsage(meta: unknown): TokenUsage | null {
  const m = meta as { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined;
  if (!m || m.promptTokenCount === undefined) return null;
  return { input: m.promptTokenCount ?? 0, output: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0) };
}
