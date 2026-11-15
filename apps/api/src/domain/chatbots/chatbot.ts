import type { BotProfile } from '../chat/prompt';

/** Configuración del asistente de un proyecto (una fila por proyecto). */
export interface ChatbotRow {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  welcome_message: string | null;
  instructions: string | null;
  suggested_questions: string[];
  primary_color: string;
  avatar_url: string | null;
  language: BotProfile['language'];
  widget_enabled: boolean;
  public_key: string;
  allowed_origins: string[];
  daily_message_limit: number;
  widget_show_sources: boolean;
  widget_auth: 'public' | 'token';
  updated_at?: string;
}

/** Lo que la empresa puede editar del asistente. */
export type ChatbotSettings = Omit<ChatbotRow, 'id' | 'company_id' | 'project_id' | 'public_key' | 'updated_at'>;

/** Valores por defecto mientras la empresa no personaliza su asistente. */
export const DEFAULT_CHATBOT = {
  name: 'Asistente',
  welcome_message: null,
  instructions: null,
  suggested_questions: [] as string[],
  primary_color: '#0f172a',
  avatar_url: null,
  language: 'auto' as const,
  widget_enabled: false,
  allowed_origins: [] as string[],
  daily_message_limit: 300,
  widget_show_sources: false,
  widget_auth: 'token' as const,
};

/** Formato de la clave pública del widget. */
export const PUBLIC_KEY_PATTERN = /^bot_[0-9a-f]{32}$/;

/** Lo que ven los visitantes del widget (sin datos de administración). */
export function publicConfig(bot: ChatbotRow) {
  return {
    name: bot.name,
    welcomeMessage: bot.welcome_message,
    suggestedQuestions: bot.suggested_questions,
    primaryColor: bot.primary_color,
    avatarUrl: bot.avatar_url,
    showSources: bot.widget_show_sources,
    allowedOrigins: bot.allowed_origins,
    /** 'token': el sitio debe entregar un token temporal emitido por su servidor. */
    auth: bot.widget_auth,
  };
}
