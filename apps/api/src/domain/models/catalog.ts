/**
 * Proveedores y modelos que se pueden elegir en la configuración del asistente.
 * Los modelos de lenguaje se pueden escribir a mano (cambian seguido); estas
 * listas son sugerencias. Los de embeddings son una lista cerrada porque cada
 * uno exige un código distinto (prefijos, tipo de tarea, dimensión).
 */

export type LlmProvider = 'gemini' | 'groq' | 'openai' | 'mistral';
export const LLM_PROVIDERS: LlmProvider[] = ['gemini', 'groq', 'openai', 'mistral'];

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  gemini: 'Gemini',
  groq: 'Groq',
  openai: 'OpenAI',
  mistral: 'Mistral',
};

/** Modelos sugeridos por proveedor (el primero es el recomendado). */
export const LLM_SUGGESTIONS: Record<LlmProvider, Array<{ id: string; note: string }>> = {
  gemini: [
    { id: 'gemini-3.5-flash', note: 'Equilibrado: rápido y preciso (recomendado)' },
    { id: 'gemini-3.6-flash', note: 'Flash más reciente' },
    { id: 'gemini-3.1-flash-lite', note: 'El más económico' },
    { id: 'gemini-3.1-pro-preview', note: 'Más razonamiento, más lento y caro' },
  ],
  groq: [
    { id: 'openai/gpt-oss-120b', note: 'Muy rápido, buen uso de herramientas (recomendado)' },
    { id: 'openai/gpt-oss-20b', note: 'Más liviano y económico' },
  ],
  openai: [
    { id: 'gpt-5.4-mini', note: 'Económico y rápido (recomendado)' },
    { id: 'gpt-5.6-terra', note: 'Equilibra calidad y costo' },
    { id: 'gpt-5.6-luna', note: 'Variante de menor costo de GPT-5.6' },
    { id: 'gpt-5.5', note: 'Más capaz, más caro' },
  ],
  mistral: [
    { id: 'mistral-medium-latest', note: 'Equilibrado, buen uso de herramientas (recomendado)' },
    { id: 'mistral-small-latest', note: 'Rápido y económico' },
    { id: 'mistral-large-latest', note: 'El más capaz de Mistral' },
  ],
};

export type EmbeddingProvider = 'local' | 'gemini' | 'openai' | 'mistral';

export interface EmbeddingModel {
  id: string;
  label: string;
  provider: EmbeddingProvider;
  dimensions: number;
  /** Texto corto para la interfaz. */
  note: string;
  /** USD por millón de tokens (0 = gratis, corre en el servidor). */
  pricePerM: number;
}

export const EMBEDDING_MODELS: EmbeddingModel[] = [
  {
    id: 'Xenova/multilingual-e5-base',
    label: 'Multilingual E5 base (local)',
    provider: 'local',
    dimensions: 768,
    note: 'Corre en el servidor: no necesita clave ni tiene costo por uso. Buen español.',
    pricePerM: 0,
  },
  {
    id: 'gemini-embedding-001',
    label: 'Gemini Embedding',
    provider: 'gemini',
    dimensions: 768,
    note: 'Muy buena calidad multilingüe. Usa la clave de Gemini del asistente.',
    pricePerM: 0.15,
  },
  {
    id: 'text-embedding-3-small',
    label: 'OpenAI text-embedding-3-small',
    provider: 'openai',
    dimensions: 1536,
    note: 'Muy económico. Usa la clave de OpenAI del asistente.',
    pricePerM: 0.02,
  },
  {
    id: 'text-embedding-3-large',
    label: 'OpenAI text-embedding-3-large',
    provider: 'openai',
    dimensions: 3072,
    note: 'La mejor calidad de OpenAI. Usa la clave de OpenAI del asistente.',
    pricePerM: 0.13,
  },
  {
    id: 'mistral-embed',
    label: 'Mistral Embed',
    provider: 'mistral',
    dimensions: 1024,
    note: 'Multilingüe y económico. Usa la clave de Mistral del asistente.',
    pricePerM: 0.1,
  },
];

export function embeddingModel(id: string): EmbeddingModel | undefined {
  return EMBEDDING_MODELS.find((m) => m.id === id);
}

/** Lo que se guarda en chatbots (null = valor por defecto de la plataforma). */
export interface ModelSettings {
  llmProvider: LlmProvider;
  llmModel: string | null;
  llmFallback: LlmProvider | 'none';
  llmFallbackModel: string | null;
  embeddingModel: string | null;
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  llmProvider: 'gemini',
  llmModel: null,
  llmFallback: 'none',
  llmFallbackModel: null,
  embeddingModel: null,
};

/** Identificadores de modelo válidos: letras, números y . _ - / : */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/:]{1,99}$/;
