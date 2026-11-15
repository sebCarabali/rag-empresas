/**
 * Conceptos del dominio de los modelos de lenguaje, independientes de
 * cualquier proveedor o SDK.
 */
import { PROVIDER_LABEL, type LlmProvider } from '../models/catalog';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Herramienta que el modelo puede llamar (esquema JSON de sus parámetros). */
export interface ToolDeclaration {
  name?: string;
  description?: string;
  parametersJsonSchema?: unknown;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export interface TokenUsage {
  input: number;
  output: number;
}

/** Lo que emite un modelo mientras responde. */
export type ModelEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; args: Record<string, unknown>; result: Record<string, unknown> }
  /** Tokens de una llamada al modelo (una por ronda). */
  | { type: 'usage'; input: number; output: number };

/** Modelo que respondió (se muestra en el chat y se guarda con el mensaje). */
export interface ModelInfo {
  provider: LlmProvider;
  model: string;
  /** true si se usó el modelo de respaldo porque el principal falló. */
  fallback: boolean;
  /** Motivo del cambio, en lenguaje claro. */
  reason?: string;
  /** Siempre 'company': la clave la pone la empresa en el asistente ('platform' solo en registros antiguos). */
  keyOwner?: 'company' | 'platform';
}

/** Un modelo concreto con la clave con que se llama. */
export interface LlmTarget {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  keyOwner: 'company';
}

/** Modelo principal y, opcionalmente, el de respaldo. */
export interface LlmRoute {
  primary: LlmTarget;
  fallback: LlmTarget | null;
}

/** Eventos del orquestador: los del modelo más el cambio de modelo y el descarte de lo parcial. */
export type LlmEvent = ModelEvent | { type: 'model'; info: ModelInfo } | { type: 'reset' };

/** El modelo terminó sin escribir texto (solo consultas o una respuesta vacía). */
export class EmptyAnswerError extends Error {
  constructor(readonly provider: LlmProvider = 'gemini') {
    super(`${PROVIDER_LABEL[provider]} no generó texto en la respuesta`);
  }
}

/** El modelo no empezó a responder a tiempo. */
export class FirstEventTimeoutError extends Error {
  constructor(readonly provider: LlmProvider) {
    super(`${PROVIDER_LABEL[provider]} no respondió a tiempo`);
  }
}

/** El asistente no tiene la clave que hace falta. El mensaje se puede mostrar al equipo de la empresa. */
export class MissingModelKeyError extends Error {
  constructor(
    readonly provider: LlmProvider,
    purpose = 'responder',
  ) {
    super(`Este asistente no tiene clave de ${PROVIDER_LABEL[provider]} para ${purpose}. Configúrala en Asistente y widget → Modelos.`);
  }
}

/** Traduce el error del proveedor a un motivo comprensible para el usuario. */
export function describeFailure(err: unknown, provider: LlmProvider = 'gemini'): string {
  const name = PROVIDER_LABEL[provider];
  if (err instanceof FirstEventTimeoutError) return `${name} no respondió a tiempo`;
  if (err instanceof EmptyAnswerError) return `${name} no generó una respuesta`;
  const raw = `${(err as { status?: number })?.status ?? ''} ${(err as Error)?.message ?? String(err)}`;
  if (/429|quota|exhausted|rate limit|resource_exhausted/i.test(raw)) return `${name} agotó su cuota`;
  if (/401|403|api key|permission|unauthenticated|invalid_api_key|unauthorized/i.test(raw)) return `la clave de ${name} no es válida o no tiene permisos`;
  if (/404|not found|model_not_found|does not exist|invalid model/i.test(raw)) return `${name} no reconoce el modelo configurado`;
  if (/500|502|503|504|unavailable|overloaded|internal/i.test(raw)) return `${name} no está disponible en este momento`;
  if (/fetch failed|network|econn|etimedout|socket/i.test(raw)) return `no se pudo conectar con ${name}`;
  return `${name} devolvió un error`;
}

/**
 * Identificador del modelo para la caché de respuestas. Con Gemini es solo el
 * modelo (así siguen sirviendo las respuestas guardadas antes de poder elegir
 * proveedor); con otros, "proveedor:modelo".
 */
export function cacheModelKey(target: Pick<LlmTarget, 'provider' | 'model'>): string {
  return target.provider === 'gemini' ? target.model : `${target.provider}:${target.model}`;
}
