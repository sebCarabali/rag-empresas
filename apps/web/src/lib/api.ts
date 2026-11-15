import { getSupabase } from './supabase/client';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type DocumentStatus = 'uploading' | 'pending' | 'processing' | 'ready' | 'failed';

export interface Company {
  id: string;
  name: string;
  role: Role;
  created_at: string;
}

export interface Project {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface DocumentItem {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  error: string | null;
  chunk_count: number;
  created_at: string;
  updated_at?: string;
  progress_stage?: 'queued' | 'reading' | 'ocr' | 'catalog' | 'embedding' | 'done' | null;
  progress_done?: number;
  progress_total?: number;
  processing_started_at?: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

export interface Source {
  index: number;
  documentId: string;
  chunkIndex?: number;
  documentName: string;
  page?: number;
  snippet: string;
  kind?: 'document' | 'catalog' | 'web';
  links?: Array<{ title: string; url: string }>;
}

export interface Enrichment {
  id: number;
  field: string;
  value: string;
  description: string | null;
  sources: Array<{ title: string; url: string }>;
  status: 'pending' | 'ready' | 'failed';
  error: string | null;
  updated_at: string;
}

/** Consulta exacta que el asistente hizo al catálogo estructurado. */
export interface ToolCall {
  name: string;
  summary: string;
  total: number | null;
  error?: string;
}

/** Modelo que generó la respuesta; fallback = se usó el respaldo (Groq). */
export type LlmProvider = 'gemini' | 'groq' | 'openai';

export const PROVIDER_LABEL: Record<LlmProvider, string> = { gemini: 'Gemini', groq: 'Groq', openai: 'OpenAI' };

/** "Gemini · gemini-3.5-flash" */
export function modelLabel(m: Pick<ModelInfo, 'provider' | 'model'>): string {
  return `${PROVIDER_LABEL[m.provider] ?? m.provider} · ${m.model}`;
}

export interface ModelSettings {
  llmProvider: LlmProvider;
  llmModel: string | null;
  llmFallback: LlmProvider | 'none';
  llmFallbackModel: string | null;
  embeddingModel: string | null;
}

export interface ProviderOption {
  id: LlmProvider;
  label: string;
  suggestions: Array<{ id: string; note: string }>;
  price: { input: number; output: number };
  /** La empresa guardó su clave (se muestran los últimos 4 caracteres). */
  company: boolean;
  last4: string | null;
  /** Hay clave de la plataforma. */
  platform: boolean;
}

export interface EmbeddingOption {
  id: string;
  label: string;
  provider: 'local' | 'gemini' | 'openai';
  dimensions: number;
  note: string;
  pricePerM: number;
}

export interface ModelsConfig {
  canEdit: boolean;
  companyId: string;
  settings: ModelSettings;
  defaults: { llm: Record<LlmProvider, string>; embeddingModel: string; fallbackEnabled: boolean };
  providers: ProviderOption[];
  embeddings: EmbeddingOption[];
  reindex: ReindexStatus;
}

export interface ModelTestResult {
  ok: boolean;
  ms: number;
  detail: string;
  model?: string;
  keyOwner?: 'company' | 'platform';
}

export interface ModelInfo {
  provider: LlmProvider;
  model: string;
  fallback: boolean;
  reason?: string;
  keyOwner?: 'company' | 'platform';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  tool_calls?: ToolCall[];
  model_info?: ModelInfo | null;
  feedback?: Feedback | null;
  created_at: string;
}

/** Cómo se encontró una respuesta en la caché. */
export interface CacheMatch {
  kind: 'exact' | 'semantic';
  question?: string;
  similarity?: number;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  /** Solo en la respuesta de creación. */
  key?: string;
}

export interface UsageDay {
  day: string;
  channel: 'app' | 'widget' | 'eval' | 'warm' | 'ocr' | 'enrich';
  total: number;
  cache_exact: number;
  cache_semantic: number;
  groq: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | string;
  company_cost: number | string | null;
  avg_ms: number | null;
}

export interface UsageReport {
  days: number;
  daily: UsageDay[];
  cachedAnswers: number;
  prices: Record<'gemini' | 'groq', { input: number; output: number }> & { openai?: { input: number; output: number } };
  models: { gemini: string; groq: string };
  semanticThreshold: number;
  autoWarm: boolean;
}

export interface ReindexStatus {
  model: string;
  indexedWith: string | null;
  status: 'running' | 'done' | 'failed' | null;
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  outdated: boolean;
  /** Modelo del reordenador, o null si está desactivado. */
  reranker: string | null;
}

export interface WarmRun {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'skipped';
  trigger: 'manual' | 'auto';
  total: number;
  done: number;
  generated: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface Feedback {
  rating: -1 | 1;
  comment: string | null;
}

/** Valoración del chat interno, con la pregunta que la originó. */
export interface FeedbackItem extends Feedback {
  message_id: string;
  question: string | null;
  answer: string | null;
  model_info: ModelInfo | null;
  updated_at: string;
}

/** Pregunta de un visitante del sitio web (widget). */
export interface WidgetMessage {
  id: string;
  session_id: string;
  question: string;
  answer: string;
  model_info: ModelInfo | null;
  cached: boolean;
  rating: -1 | 1 | null;
  feedback_comment: string | null;
  created_at: string;
}

export interface EvalCase {
  id: string;
  question: string;
  must_include: string[];
  must_not_include: string[];
  notes: string | null;
  created_at: string;
}

export interface EvalRun {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  total: number;
  passed: number;
  failed: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface EvalResult {
  id: string;
  case_id: string | null;
  question: string;
  answer: string;
  passed: boolean;
  missing: string[];
  forbidden: string[];
  model_info: ModelInfo | null;
  duration_ms: number | null;
  error: string | null;
}

export type EvalCaseInput = Pick<EvalCase, 'question' | 'must_include' | 'must_not_include'> & { notes?: string };

export interface Chatbot {
  id?: string;
  project_id: string;
  name: string;
  welcome_message: string | null;
  instructions: string | null;
  suggested_questions: string[];
  primary_color: string;
  avatar_url: string | null;
  language: 'auto' | 'es' | 'en' | 'pt';
  widget_enabled: boolean;
  public_key: string | null;
  allowed_origins: string[];
  daily_message_limit: number;
  widget_show_sources: boolean;
  widget_auth: 'public' | 'token';
}

export interface CompanySettings {
  canEdit: boolean;
  gemini: { configured: boolean; last4: string | null; updatedAt: string | null };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('Tu sesión expiró. Vuelve a iniciar sesión.', 401);
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join('. ') : data.message;
    throw new ApiError(message || `Error ${res.status}`, res.status);
  }
  return data as T;
}

export const api = {
  apiKeys: (projectId: string) => request<ApiKey[]>('GET', `/projects/${projectId}/api-keys`),
  createApiKey: (projectId: string, name: string) => request<ApiKey>('POST', `/projects/${projectId}/api-keys`, { name }),
  revokeApiKey: (projectId: string, keyId: string) => request<void>('DELETE', `/projects/${projectId}/api-keys/${keyId}`),
  widgetTestToken: (projectId: string) =>
    request<{ token: string; expiresAt: string }>('POST', `/projects/${projectId}/chatbot/test-token`),
  usage: (projectId: string, days = 30) =>
    request<UsageReport>(
      'GET',
      `/projects/${projectId}/usage?days=${days}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
    ),
  reindexStatus: (projectId: string) => request<ReindexStatus>('GET', `/projects/${projectId}/reindex`),
  reindex: (projectId: string) => request<ReindexStatus>('POST', `/projects/${projectId}/reindex`),
  warmRuns: (projectId: string) => request<WarmRun[]>('GET', `/projects/${projectId}/cache/warm`),
  warmCache: (projectId: string) => request<WarmRun>('POST', `/projects/${projectId}/cache/warm`),
  rateMessage: (messageId: string, rating: -1 | 1, comment?: string) =>
    request<Feedback>('PUT', `/messages/${messageId}/feedback`, { rating, comment }),
  unrateMessage: (messageId: string) => request<void>('DELETE', `/messages/${messageId}/feedback`),
  feedback: (projectId: string, rating: 'all' | 'up' | 'down' = 'all') =>
    request<FeedbackItem[]>('GET', `/projects/${projectId}/feedback?rating=${rating}`),
  widgetMessages: (projectId: string, rating: 'all' | 'up' | 'down' = 'all', before?: string) =>
    request<WidgetMessage[]>(
      'GET',
      `/projects/${projectId}/widget-messages?rating=${rating}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    ),
  evalCases: (projectId: string) => request<EvalCase[]>('GET', `/projects/${projectId}/evals/cases`),
  createEvalCase: (projectId: string, input: EvalCaseInput) =>
    request<EvalCase>('POST', `/projects/${projectId}/evals/cases`, input),
  updateEvalCase: (projectId: string, caseId: string, input: EvalCaseInput) =>
    request<EvalCase>('PUT', `/projects/${projectId}/evals/cases/${caseId}`, input),
  deleteEvalCase: (projectId: string, caseId: string) =>
    request<void>('DELETE', `/projects/${projectId}/evals/cases/${caseId}`),
  evalRuns: (projectId: string) => request<EvalRun[]>('GET', `/projects/${projectId}/evals/runs`),
  startEvalRun: (projectId: string) => request<EvalRun>('POST', `/projects/${projectId}/evals/runs`),
  evalRun: (projectId: string, runId: string) =>
    request<EvalRun & { results: EvalResult[] }>('GET', `/projects/${projectId}/evals/runs/${runId}`),

  me: () => request<{ user: { id: string; email?: string }; companies: Company[] }>('GET', '/me'),
  createCompany: (name: string) => request<Company>('POST', '/companies', { name }),

  projects: (companyId: string) => request<Project[]>('GET', `/companies/${companyId}/projects`),
  createProject: (companyId: string, name: string, description?: string) =>
    request<Project>('POST', `/companies/${companyId}/projects`, { name, description }),
  project: (projectId: string) => request<Project>('GET', `/projects/${projectId}`),
  deleteProject: (projectId: string) => request<void>('DELETE', `/projects/${projectId}`),

  documents: (projectId: string) => request<DocumentItem[]>('GET', `/projects/${projectId}/documents`),
  processDocument: (documentId: string) => request<DocumentItem>('POST', `/documents/${documentId}/process`),
  deleteDocument: (documentId: string) => request<void>('DELETE', `/documents/${documentId}`),

  /** Registra el documento, sube el archivo directo a Storage y lo encola. */
  async uploadDocument(
    projectId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<DocumentItem> {
    const mime = guessMime(file.name);
    const { document, upload } = await request<{
      document: DocumentItem;
      upload: { path: string; token: string; signedUrl: string };
    }>('POST', `/projects/${projectId}/documents`, {
      fileName: file.name,
      mimeType: mime,
      sizeBytes: file.size,
    });
    try {
      await uploadWithProgress(upload.signedUrl, file, mime, onProgress);
    } catch (e) {
      await api.deleteDocument(document.id).catch(() => undefined);
      throw new ApiError(`No se pudo subir el archivo: ${(e as Error).message}`, 400);
    }
    return api.processDocument(document.id);
  },

  enrichments: (projectId: string) =>
    request<{ enabled: boolean; fields: string[]; items: Enrichment[] }>('GET', `/projects/${projectId}/enrichments`),
  refreshEnrichments: (projectId: string, force = false) =>
    request<{ queued: boolean }>('POST', `/projects/${projectId}/enrichments/refresh`, { force }),

  chatbot: (projectId: string) =>
    request<{ exists: boolean; canEdit: boolean; messagesToday: number; chatbot: Chatbot }>('GET', `/projects/${projectId}/chatbot`),
  saveChatbot: (projectId: string, values: Omit<Chatbot, 'id' | 'project_id' | 'public_key'>) =>
    request<Chatbot>('PUT', `/projects/${projectId}/chatbot`, values),
  rotateChatbotKey: (projectId: string) => request<Chatbot>('POST', `/projects/${projectId}/chatbot/rotate-key`, {}),

  companySettings: (companyId: string) => request<CompanySettings>('GET', `/companies/${companyId}/settings`),
  setGeminiKey: (companyId: string, apiKey: string) =>
    request<void>('PUT', `/companies/${companyId}/gemini-key`, { apiKey }),
  deleteGeminiKey: (companyId: string) => request<void>('DELETE', `/companies/${companyId}/gemini-key`),

  models: (projectId: string) => request<ModelsConfig>('GET', `/projects/${projectId}/models`),
  saveModels: (projectId: string, settings: ModelSettings) => request<ModelsConfig>('PUT', `/projects/${projectId}/models`, settings),
  testModel: (projectId: string, body: { kind: 'llm' | 'embedding'; provider?: LlmProvider; model?: string | null }) =>
    request<ModelTestResult>('POST', `/projects/${projectId}/models/test`, body),
  setProviderKey: (companyId: string, provider: LlmProvider, apiKey: string) =>
    request<void>('PUT', `/companies/${companyId}/provider-keys/${provider}`, { apiKey }),
  deleteProviderKey: (companyId: string, provider: LlmProvider) =>
    request<void>('DELETE', `/companies/${companyId}/provider-keys/${provider}`),

  conversations: (projectId: string) => request<Conversation[]>('GET', `/projects/${projectId}/conversations`),
  createConversation: (projectId: string) =>
    request<Conversation>('POST', `/projects/${projectId}/conversations`, {}),
  deleteConversation: (id: string) => request<void>('DELETE', `/conversations/${id}`),
  messages: (conversationId: string) => request<Message[]>('GET', `/conversations/${conversationId}/messages`),

  /** Envía una pregunta y procesa la respuesta en streaming (NDJSON). */
  async ask(
    conversationId: string,
    content: string,
    handlers: {
      onSources: (sources: Source[]) => void;
      onDelta: (text: string) => void;
      onTool: (call: ToolCall) => void;
      onModel: (info: ModelInfo) => void;
      onReset: () => void;
      onDone: (info: { messageId: string; title: string; cached: boolean; cacheMatch?: CacheMatch | null }) => void;
      onError: (message: string) => void;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const headers = await authHeaders();
    const res = await fetch(`${API_URL}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal,
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      handlers.onError(data.message ?? `Error ${res.status}`);
      return;
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'sources') handlers.onSources(event.sources);
        else if (event.type === 'delta') handlers.onDelta(event.text);
        else if (event.type === 'tool') handlers.onTool(event.call);
        else if (event.type === 'model') handlers.onModel(event.info);
        else if (event.type === 'reset') handlers.onReset();
        else if (event.type === 'done') handlers.onDone(event);
        else if (event.type === 'error') handlers.onError(event.message);
      }
    }
  },
};

/** Evento de un stream NDJSON del chat. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StreamEvent = { type: string } & Record<string, any>;

/** Lee una respuesta NDJSON y llama a onEvent por cada línea. */
export async function readNdjson(res: Response, onEvent: (event: StreamEvent) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as StreamEvent);
  }
}

/** El token del widget (modo protegido) venció o no es válido. */
export class WidgetTokenError extends Error {}

/** API pública del widget (sin sesión). */
export const widgetApi = {
  config: async (publicKey: string) => {
    const res = await fetch(`${API_URL}/widget/${publicKey}/config`);
    if (!res.ok) throw new ApiError('Chatbot no disponible', res.status);
    return (await res.json()) as {
      name: string;
      welcomeMessage: string | null;
      suggestedQuestions: string[];
      primaryColor: string;
      avatarUrl: string | null;
      showSources: boolean;
      auth?: 'public' | 'token';
    };
  },
  ask: async (
    publicKey: string,
    content: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    sessionId: string,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
    token?: string | null,
  ) => {
    const res = await fetch(`${API_URL}/widget/${publicKey}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Widget-Token': token } : {}) },
      body: JSON.stringify({ content, history, sessionId }),
      signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.code === 'widget_token_invalid') throw new WidgetTokenError(data.message);
      onEvent({ type: 'error', message: data.message ?? `Error ${res.status}` });
      return;
    }
    await readNdjson(res, onEvent);
  },
  rate: async (
    publicKey: string,
    messageId: string,
    sessionId: string,
    rating: -1 | 1,
    comment?: string,
    token?: string | null,
  ) => {
    const res = await fetch(`${API_URL}/widget/${publicKey}/messages/${messageId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Widget-Token': token } : {}) },
      body: JSON.stringify({ sessionId, rating, comment }),
    });
    if (!res.ok) throw new ApiError('No se pudo guardar la valoración', res.status);
  },
};

/**
 * Sube el archivo directo a Supabase Storage con la URL firmada, informando el
 * avance (fetch no lo permite; XMLHttpRequest sí). Mismo formato que usa
 * supabase-js en uploadToSignedUrl.
 */
function uploadWithProgress(
  signedUrl: string,
  file: File,
  mime: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', new Blob([file], { type: mime }), file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `error ${xhr.status}`;
      try {
        message = JSON.parse(xhr.responseText).message ?? message;
      } catch {
        // respuesta sin JSON
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('se perdió la conexión'));
    xhr.send(form);
  });
}

export const ACCEPTED_FILES = '.pdf,.docx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp';

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md: 'text/markdown',
  csv: 'text/csv',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Tipo del archivo por su extensión. Se prefiere a file.type porque los
 * navegadores no coinciden (Windows reporta los CSV como application/vnd.ms-excel).
 */
function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'text/plain';
}
