import { Injectable } from '@nestjs/common';
import type { ChatTurn } from '../../domain/llm/llm';
import type {
  Conversation,
  ConversationRepository,
  ConversationRow,
  DataScope,
  FeedbackRepository,
  FeedbackRow,
  NewMessage,
  QuestionHistory,
  Rating,
  WidgetMessageInput,
  WidgetMessageRepository,
} from '../../application/ports';
import { SupabaseService } from '../supabase/supabase.service';
import { check, unwrap } from './supabase-result';

const CONVERSATION_COLUMNS = 'id, project_id, title, created_at, updated_at';

/** Adaptador (Repository) sobre conversations y messages (con RLS del usuario). */
@Injectable()
export class SupabaseConversationRepository implements ConversationRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async list(scope: DataScope, projectId: string): Promise<ConversationRow[]> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('conversations')
        .select(CONVERSATION_COLUMNS)
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false }),
    ) as ConversationRow[];
  }

  async create(scope: DataScope, input: { projectId: string; companyId: string; title: string }): Promise<ConversationRow> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('conversations')
        .insert({ project_id: input.projectId, company_id: input.companyId, title: input.title })
        .select(CONVERSATION_COLUMNS)
        .single(),
    ) as ConversationRow;
  }

  async get(scope: DataScope, id: string): Promise<Conversation> {
    return unwrap(
      await this.supabase.client(scope).from('conversations').select('id, project_id, company_id, title').eq('id', id).single(),
      'Conversación no encontrada',
    ) as Conversation;
  }

  async delete(scope: DataScope, id: string): Promise<void> {
    unwrap(
      await this.supabase.client(scope).from('conversations').delete().eq('id', id).select('id').single(),
      'Conversación no encontrada',
    );
  }

  async messages(scope: DataScope, id: string): Promise<unknown[]> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('messages')
        .select('id, role, content, sources, tool_calls, model_info, created_at, feedback:message_feedback(rating, comment)')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true }),
    );
  }

  async recentTurns(scope: DataScope, id: string, limit: number): Promise<ChatTurn[]> {
    const rows = unwrap(
      await this.supabase
        .client(scope)
        .from('messages')
        .select('role, content')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return (rows as ChatTurn[]).reverse();
  }

  async addMessage(scope: DataScope, message: NewMessage): Promise<string> {
    const row = unwrap(
      await this.supabase
        .client(scope)
        .from('messages')
        .insert({
          conversation_id: message.conversationId,
          role: message.role,
          content: message.content,
          ...(message.sources ? { sources: message.sources } : {}),
          ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
          ...(message.modelInfo !== undefined ? { model_info: message.modelInfo } : {}),
        })
        .select('id')
        .single(),
    );
    return row.id as string;
  }

  async rename(scope: DataScope, id: string, title: string): Promise<void> {
    await this.supabase.client(scope).from('conversations').update({ title }).eq('id', id);
  }
}

/** Adaptador (Repository) sobre message_feedback. */
@Injectable()
export class SupabaseFeedbackRepository implements FeedbackRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findMessage(scope: DataScope, messageId: string): Promise<{ role: string; companyId: string; projectId: string }> {
    // RLS: solo se ven los mensajes de las conversaciones propias.
    const message = unwrap(
      await this.supabase
        .client(scope)
        .from('messages')
        .select('id, role, conversations!inner(company_id, project_id)')
        .eq('id', messageId)
        .single(),
      'Mensaje no encontrado',
    );
    const conv = message.conversations as unknown as { company_id: string; project_id: string };
    return { role: message.role as string, companyId: conv.company_id, projectId: conv.project_id };
  }

  async save(
    scope: DataScope,
    input: { messageId: string; companyId: string; projectId: string; userId: string; rating: Rating; comment: string | null },
  ): Promise<FeedbackRow> {
    return unwrap(
      await this.supabase
        .client(scope)
        .from('message_feedback')
        .upsert(
          {
            message_id: input.messageId,
            company_id: input.companyId,
            project_id: input.projectId,
            user_id: input.userId,
            rating: input.rating,
            comment: input.comment,
          },
          { onConflict: 'message_id' },
        )
        .select('message_id, rating, comment, updated_at')
        .single(),
    ) as FeedbackRow;
  }

  async remove(scope: DataScope, messageId: string): Promise<void> {
    check((await this.supabase.client(scope).from('message_feedback').delete().eq('message_id', messageId)).error);
  }

  /**
   * Las valoraciones se leen con los permisos del usuario (owner/admin ven las
   * de todo el equipo; el resto, solo las suyas). Los textos se leen con
   * service_role, porque los mensajes de otros miembros no son visibles para él.
   */
  async list(scope: DataScope, projectId: string, rating: Rating | undefined, limit: number): Promise<unknown[]> {
    let query = this.supabase
      .client(scope)
      .from('message_feedback')
      .select('message_id, rating, comment, created_at, updated_at')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (rating) query = query.eq('rating', rating);
    const rows = unwrap(await query) as FeedbackRow[];
    if (!rows.length) return [];

    const admin = this.supabase.admin;
    const { data: answers } = await admin
      .from('messages')
      .select('id, conversation_id, content, model_info, created_at')
      .in('id', rows.map((f) => f.message_id));
    const byId = new Map((answers ?? []).map((m) => [m.id as string, m]));

    return Promise.all(
      rows.map(async (f) => {
        const answer = byId.get(f.message_id);
        let question: string | null = null;
        if (answer) {
          const { data: prev } = await admin
            .from('messages')
            .select('content')
            .eq('conversation_id', answer.conversation_id)
            .eq('role', 'user')
            .lte('created_at', answer.created_at)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          question = (prev?.content as string) ?? null;
        }
        return { ...f, question, answer: answer?.content ?? null, model_info: answer?.model_info ?? null };
      }),
    );
  }
}

/** Adaptador (Repository) sobre widget_messages. */
@Injectable()
export class SupabaseWidgetMessageRepository implements WidgetMessageRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async log(input: WidgetMessageInput): Promise<string | null> {
    const { data, error } = await this.supabase.admin
      .from('widget_messages')
      .insert({
        chatbot_id: input.chatbotId,
        company_id: input.companyId,
        project_id: input.projectId,
        session_id: input.sessionId,
        question: input.question,
        answer: input.answer,
        model_info: input.modelInfo,
        cached: input.cached,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data?.id as string) ?? null;
  }

  async rate(input: {
    chatbotId: string;
    sessionId: string;
    messageId: string;
    rating: Rating;
    comment: string | null;
  }): Promise<{ id: string; rating: Rating } | null> {
    const { data, error } = await this.supabase.admin
      .from('widget_messages')
      .update({ rating: input.rating, feedback_comment: input.comment, feedback_at: new Date().toISOString() })
      .eq('id', input.messageId)
      .eq('chatbot_id', input.chatbotId)
      .eq('session_id', input.sessionId)
      .select('id, rating')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { id: string; rating: Rating } | null) ?? null;
  }

  async list(scope: DataScope, projectId: string, filter: { rating?: Rating; before?: string; limit: number }): Promise<unknown[]> {
    let query = this.supabase
      .client(scope)
      .from('widget_messages')
      .select('id, session_id, question, answer, model_info, cached, rating, feedback_comment, feedback_at, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(filter.limit);
    if (filter.rating) query = query.eq('rating', filter.rating);
    if (filter.before) query = query.lt('created_at', filter.before);
    return unwrap(await query);
  }
}

/** Adaptador de QuestionHistory: preguntas recientes del widget y del equipo. */
@Injectable()
export class SupabaseQuestionHistory implements QuestionHistory {
  constructor(private readonly supabase: SupabaseService) {}

  async widgetQuestions(projectId: string, since: Date, limit: number): Promise<string[]> {
    const { data } = await this.supabase.admin
      .from('widget_messages')
      .select('question')
      .eq('project_id', projectId)
      .gte('created_at', since.toISOString())
      .limit(limit);
    return (data ?? []).map((r) => r.question as string);
  }

  async teamQuestions(projectId: string, since: Date, limit: number): Promise<string[]> {
    const { data } = await this.supabase.admin
      .from('messages')
      .select('content, conversations!inner(project_id)')
      .eq('conversations.project_id', projectId)
      .eq('role', 'user')
      .gte('created_at', since.toISOString())
      .limit(limit);
    return (data ?? []).map((r) => r.content as string);
  }
}
