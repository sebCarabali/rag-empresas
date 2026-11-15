import type { ChatbotRow, ChatbotSettings } from '../../domain/chatbots/chatbot';
import type { DataScope } from './data-scope';
import type { ProjectRef } from './projects.repository';

/** Puerto de salida (Repository): asistentes de los proyectos. */
export interface ChatbotRepository {
  findByProject(scope: DataScope, projectId: string): Promise<ChatbotRow | null>;
  findByPublicKey(publicKey: string): Promise<ChatbotRow | null>;
  /** Crea o actualiza. ForbiddenError si el usuario no puede editarlo. */
  save(scope: DataScope, project: ProjectRef, values: ChatbotSettings): Promise<ChatbotRow>;
  setPublicKey(scope: DataScope, chatbotId: string, publicKey: string): Promise<ChatbotRow>;
  messagesToday(scope: DataScope, chatbotId: string): Promise<number>;
  /** Cuenta un mensaje del widget hoy (atómico) y devuelve el total del día. */
  registerWidgetMessage(chatbotId: string): Promise<number>;
}

export const CHATBOT_REPOSITORY = Symbol('CHATBOT_REPOSITORY');
