import { getSupabase } from './supabase/client';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

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
export interface ModelInfo {
  provider: 'gemini' | 'groq';
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
  created_at: string;
}

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
  async uploadDocument(projectId: string, file: File): Promise<DocumentItem> {
    const { document, upload } = await request<{
      document: DocumentItem;
      upload: { path: string; token: string };
    }>('POST', `/projects/${projectId}/documents`, {
      fileName: file.name,
      mimeType: file.type || guessMime(file.name),
      sizeBytes: file.size,
    });
    const { error } = await getSupabase()
      .storage.from('documents')
      .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type || guessMime(file.name) });
    if (error) {
      await api.deleteDocument(document.id).catch(() => undefined);
      throw new ApiError(`No se pudo subir el archivo: ${error.message}`, 400);
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
      onDone: (info: { messageId: string; title: string; cached: boolean }) => void;
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
    };
  },
  ask: async (
    publicKey: string,
    content: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ) => {
    const res = await fetch(`${API_URL}/widget/${publicKey}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, history }),
      signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onEvent({ type: 'error', message: data.message ?? `Error ${res.status}` });
      return;
    }
    await readNdjson(res, onEvent);
  },
};

export const ACCEPTED_FILES = '.pdf,.docx,.txt,.md,.csv';

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'md':
      return 'text/markdown';
    case 'csv':
      return 'text/csv';
    default:
      return 'text/plain';
  }
}
