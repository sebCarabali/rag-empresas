import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotProfile } from '../chat/prompt';

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

export const CHATBOT_COLUMNS =
  'id, company_id, project_id, name, welcome_message, instructions, suggested_questions, primary_color, ' +
  'avatar_url, language, widget_enabled, public_key, allowed_origins, daily_message_limit, widget_show_sources, widget_auth, updated_at';

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

@Injectable()
export class ChatbotsService {
  async findByProject(db: SupabaseClient, projectId: string): Promise<ChatbotRow | null> {
    const { data, error } = await db.from('chatbots').select(CHATBOT_COLUMNS).eq('project_id', projectId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as ChatbotRow) ?? null;
  }

  async findByPublicKey(db: SupabaseClient, publicKey: string): Promise<ChatbotRow | null> {
    if (!/^bot_[0-9a-f]{32}$/.test(publicKey)) return null;
    const { data, error } = await db.from('chatbots').select(CHATBOT_COLUMNS).eq('public_key', publicKey).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as ChatbotRow) ?? null;
  }

  profile(bot: Pick<ChatbotRow, 'name' | 'language' | 'instructions'> | null, audience: BotProfile['audience']): BotProfile | null {
    if (!bot) return audience === 'public' ? { ...DEFAULT_CHATBOT, audience } : null;
    return { name: bot.name, language: bot.language, instructions: bot.instructions, audience };
  }
}
