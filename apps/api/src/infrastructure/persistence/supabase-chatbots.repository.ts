import { Injectable } from '@nestjs/common';
import { PUBLIC_KEY_PATTERN, type ChatbotRow, type ChatbotSettings } from '../../domain/chatbots/chatbot';
import { ForbiddenError } from '../../domain/errors';
import type { ChatbotRepository, DataScope, ProjectRef } from '../../application/ports';
import { SupabaseService } from '../supabase/supabase.service';
import { check } from './supabase-result';

const CHATBOT_COLUMNS =
  'id, company_id, project_id, name, welcome_message, instructions, suggested_questions, primary_color, ' +
  'avatar_url, language, widget_enabled, public_key, allowed_origins, daily_message_limit, widget_show_sources, widget_auth, updated_at';

/** Adaptador (Repository) sobre las tablas chatbots y widget_usage. */
@Injectable()
export class SupabaseChatbotRepository implements ChatbotRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findByProject(scope: DataScope, projectId: string): Promise<ChatbotRow | null> {
    const { data, error } = await this.supabase
      .client(scope)
      .from('chatbots')
      .select(CHATBOT_COLUMNS)
      .eq('project_id', projectId)
      .maybeSingle();
    check(error);
    return (data as unknown as ChatbotRow) ?? null;
  }

  async findByPublicKey(publicKey: string): Promise<ChatbotRow | null> {
    if (!PUBLIC_KEY_PATTERN.test(publicKey)) return null;
    const { data, error } = await this.supabase.admin.from('chatbots').select(CHATBOT_COLUMNS).eq('public_key', publicKey).maybeSingle();
    check(error);
    return (data as unknown as ChatbotRow) ?? null;
  }

  async save(scope: DataScope, project: ProjectRef, values: ChatbotSettings): Promise<ChatbotRow> {
    const db = this.supabase.client(scope);
    const existing = await this.findByProject(scope, project.id);
    const { data, error } = existing
      ? await db.from('chatbots').update(values).eq('id', existing.id).select(CHATBOT_COLUMNS).maybeSingle()
      : await db
          .from('chatbots')
          .insert({ ...values, project_id: project.id, company_id: project.companyId })
          .select(CHATBOT_COLUMNS)
          .maybeSingle();
    if (error?.code === '42501' || (!error && !data)) throw new ForbiddenError('Solo owner o admin pueden configurar el asistente');
    check(error);
    return data as unknown as ChatbotRow;
  }

  async setPublicKey(scope: DataScope, chatbotId: string, publicKey: string): Promise<ChatbotRow> {
    const { data, error } = await this.supabase
      .client(scope)
      .from('chatbots')
      .update({ public_key: publicKey })
      .eq('id', chatbotId)
      .select(CHATBOT_COLUMNS)
      .maybeSingle();
    if (error?.code === '42501' || (!error && !data)) throw new ForbiddenError('Solo owner o admin pueden cambiar la clave');
    check(error);
    return data as unknown as ChatbotRow;
  }

  async messagesToday(scope: DataScope, chatbotId: string): Promise<number> {
    const { data } = await this.supabase
      .client(scope)
      .from('widget_usage')
      .select('messages')
      .eq('chatbot_id', chatbotId)
      .eq('day', new Date().toISOString().slice(0, 10))
      .maybeSingle();
    return (data?.messages as number) ?? 0;
  }

  async registerWidgetMessage(chatbotId: string): Promise<number> {
    const { data, error } = await this.supabase.admin.rpc('widget_register_message', { p_chatbot_id: chatbotId });
    if (error) throw new Error(error.message);
    return Number(data);
  }
}
