import type { LlmProvider } from '../../domain/models/catalog';

/**
 * Diferencias entre las APIs "compatibles con OpenAI" (Strategy). Agregar un
 * proveedor de este tipo es agregar un dialecto: el adaptador no cambia (OCP).
 */
export interface OpenAiDialect {
  provider: Exclude<LlmProvider, 'gemini'>;
  label: string;
  baseUrl: string;
  /** Pide el total de tokens al final del stream (stream_options.include_usage). */
  streamUsage: boolean;
  /** Incluye el nombre de la función en los mensajes con el resultado de una herramienta. */
  toolResultName?: boolean;
  /** Ajustes propios del proveedor sobre el cuerpo de /chat/completions. */
  customize?(body: Record<string, unknown>, model: string): void;
}

export const GROQ_DIALECT: OpenAiDialect = {
  provider: 'groq',
  label: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  streamUsage: true,
  customize(body, model) {
    // Los modelos gpt-oss razonan antes de responder; "low" mantiene la latencia baja.
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
  },
};

export const OPENAI_DIALECT: OpenAiDialect = {
  provider: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  streamUsage: true,
};

/** Mistral envía el uso en el último evento sin pedirlo y rechaza parámetros que no conoce. */
export const MISTRAL_DIALECT: OpenAiDialect = {
  provider: 'mistral',
  label: 'Mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  streamUsage: false,
  toolResultName: true,
};

export const OPENAI_DIALECTS: OpenAiDialect[] = [GROQ_DIALECT, OPENAI_DIALECT, MISTRAL_DIALECT];

export function dialectFor(provider: LlmProvider): OpenAiDialect | undefined {
  return OPENAI_DIALECTS.find((d) => d.provider === provider);
}
