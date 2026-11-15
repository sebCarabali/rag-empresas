import type { Source } from '../../domain/chat/prompt';
import type { ChatTurn, ModelInfo } from '../../domain/llm/llm';
import type { DataScope } from './data-scope';
import type { CatalogToolCall } from './knowledge-base.port';

export interface ConversationRow {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  project_id: string;
  company_id: string;
  title: string;
}

export interface NewMessage {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  toolCalls?: CatalogToolCall[];
  modelInfo?: ModelInfo | null;
}

/** Puerto de salida (Repository): conversaciones del chat de la app. NotFoundError si no se ve. */
export interface ConversationRepository {
  list(scope: DataScope, projectId: string): Promise<ConversationRow[]>;
  create(scope: DataScope, input: { projectId: string; companyId: string; title: string }): Promise<ConversationRow>;
  get(scope: DataScope, id: string): Promise<Conversation>;
  delete(scope: DataScope, id: string): Promise<void>;
  /** Mensajes con su valoración, del más antiguo al más reciente. */
  messages(scope: DataScope, id: string): Promise<unknown[]>;
  /** Los últimos `limit` turnos, en orden cronológico. */
  recentTurns(scope: DataScope, id: string, limit: number): Promise<ChatTurn[]>;
  /** Devuelve el id del mensaje. */
  addMessage(scope: DataScope, message: NewMessage): Promise<string>;
  rename(scope: DataScope, id: string, title: string): Promise<void>;
}

export type Rating = -1 | 1;

export interface FeedbackRow {
  message_id: string;
  rating: Rating;
  comment: string | null;
  created_at?: string;
  updated_at: string;
}

/** Puerto de salida (Repository): valoraciones 👍/👎 del chat de la app. */
export interface FeedbackRepository {
  /** Mensaje que el usuario puede valorar. NotFoundError si no lo ve. */
  findMessage(scope: DataScope, messageId: string): Promise<{ role: string; companyId: string; projectId: string }>;
  save(
    scope: DataScope,
    input: { messageId: string; companyId: string; projectId: string; userId: string; rating: Rating; comment: string | null },
  ): Promise<FeedbackRow>;
  remove(scope: DataScope, messageId: string): Promise<void>;
  /** Valoraciones visibles para el usuario, con la pregunta y la respuesta (aunque sean de otro miembro). */
  list(scope: DataScope, projectId: string, rating: Rating | undefined, limit: number): Promise<unknown[]>;
}

export interface WidgetMessageInput {
  chatbotId: string;
  companyId: string;
  projectId: string;
  sessionId: string;
  question: string;
  answer: string;
  modelInfo: ModelInfo | null;
  cached: boolean;
}

/** Puerto de salida (Repository): lo que preguntan los visitantes del widget. */
export interface WidgetMessageRepository {
  /** Devuelve el id, o null si no se pudo registrar. */
  log(input: WidgetMessageInput): Promise<string | null>;
  /** Valoración del visitante, solo sobre mensajes de su sesión. null si no existe. */
  rate(
    input: { chatbotId: string; sessionId: string; messageId: string; rating: Rating; comment: string | null },
  ): Promise<{ id: string; rating: Rating } | null>;
  list(scope: DataScope, projectId: string, filter: { rating?: Rating; before?: string; limit: number }): Promise<unknown[]>;
}

/** Puerto de salida: preguntas recientes (para precalentar la caché). */
export interface QuestionHistory {
  widgetQuestions(projectId: string, since: Date, limit: number): Promise<string[]>;
  teamQuestions(projectId: string, since: Date, limit: number): Promise<string[]>;
}

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');
export const FEEDBACK_REPOSITORY = Symbol('FEEDBACK_REPOSITORY');
export const WIDGET_MESSAGE_REPOSITORY = Symbol('WIDGET_MESSAGE_REPOSITORY');
export const QUESTION_HISTORY = Symbol('QUESTION_HISTORY');
