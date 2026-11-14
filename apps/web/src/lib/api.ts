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
  documentName: string;
  page?: number;
  snippet: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  created_at: string;
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
      onDone: (info: { messageId: string; title: string }) => void;
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
        else if (event.type === 'done') handlers.onDone(event);
        else if (event.type === 'error') handlers.onError(event.message);
      }
    }
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
