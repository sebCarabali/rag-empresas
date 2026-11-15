import type { LlmProvider } from '../../domain/models/catalog';
import type { ChatTurn, ModelEvent, ToolDeclaration, ToolExecutor } from '../../domain/llm/llm';

/** Una conversación lista para enviar a un modelo concreto. */
export interface ChatRequest {
  systemInstruction: string;
  turns: ChatTurn[];
  model: string;
  apiKey: string;
  tools?: ToolDeclaration[];
  execute?: ToolExecutor;
  signal?: AbortSignal;
}

/**
 * Puerto de salida (Strategy): un proveedor de modelos de lenguaje. Cada
 * adaptador (Gemini, OpenAI, Groq, Mistral…) sabe hablar con su API y emite
 * los mismos eventos: texto, llamadas a herramientas y tokens usados.
 */
export interface ChatModel {
  readonly provider: LlmProvider;
  stream(request: ChatRequest): AsyncGenerator<ModelEvent>;
}

/** Token de inyección: lista de adaptadores registrados. */
export const CHAT_MODELS = Symbol('CHAT_MODELS');
