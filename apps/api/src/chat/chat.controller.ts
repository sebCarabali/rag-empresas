import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../common/supabase-error';
import { MissingModelKeyError } from '../models/project-keys.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ChatbotsService } from '../chatbots/chatbots.service';
import { ChatEngineService, type CacheMatch } from './chat-engine.service';
import type { CatalogToolCall } from './catalog-tools';
import { type ChatTurn } from './gemini.service';
import type { ModelInfo } from './llm.service';
import type { Source } from './prompt';

class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

class SendMessageDto {
  @IsString()
  @Length(1, 4000)
  content: string;
}

/** Mensajes previos que se envían al modelo como historial. */
const HISTORY_LIMIT = 10;
const DEFAULT_TITLE = 'Nueva conversación';

@Controller()
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly engine: ChatEngineService,
    private readonly chatbots: ChatbotsService,
  ) {}

  @Get('projects/:projectId/conversations')
  async list(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db
        .from('conversations')
        .select('id, project_id, title, created_at, updated_at')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false }),
    );
  }

  @Post('projects/:projectId/conversations')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateConversationDto,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(
      await db.from('projects').select('id, company_id').eq('id', projectId).single(),
      'Proyecto no encontrado',
    );
    return unwrap(
      await db
        .from('conversations')
        .insert({ project_id: project.id, company_id: project.company_id, title: dto.title || DEFAULT_TITLE })
        .select('id, project_id, title, created_at, updated_at')
        .single(),
    );
  }

  @Get('conversations/:conversationId/messages')
  async messages(@CurrentUser() user: AuthUser, @Param('conversationId', ParseUUIDPipe) id: string) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db
        .from('messages')
        .select('id, role, content, sources, tool_calls, model_info, created_at, feedback:message_feedback(rating, comment)')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true }),
    );
  }

  @Delete('conversations/:conversationId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('conversationId', ParseUUIDPipe) id: string) {
    const db = this.supabase.forUser(user.accessToken);
    unwrap(
      await db.from('conversations').delete().eq('id', id).select('id').single(),
      'Conversación no encontrada',
    );
  }

  /**
   * Pregunta → (caché) → embedding → búsqueda híbrida diversificada (RLS)
   * → Gemini en streaming, con herramientas de catálogo si el proyecto tiene CSV.
   * Responde NDJSON (una línea JSON por evento):
   *   {"type":"sources","sources":[...]}
   *   {"type":"model","info":{...}}           (modelo que responde; cambia si hay respaldo)
   *   {"type":"reset"}                         (descartar texto parcial antes del cambio de modelo)
   *   {"type":"tool","call":{...}}             (consultas exactas al catálogo)
   *   {"type":"delta","text":"..."}            (varias)
   *   {"type":"done","messageId":"...","title":"...","cached":false}
   *   {"type":"error","message":"..."}
   */
  @Post('conversations/:conversationId/messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    const question = dto.content.trim();

    // Validaciones antes de abrir el stream, para responder con códigos HTTP normales.
    const conversation = unwrap(
      await db.from('conversations').select('id, project_id, company_id, title').eq('id', conversationId).single(),
      'Conversación no encontrada',
    );
    const previous = unwrap(
      await db
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT),
    ).reverse() as ChatTurn[];

    unwrap(
      await db
        .from('messages')
        .insert({ conversation_id: conversationId, role: 'user', content: question })
        .select('id')
        .single(),
    );

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const emit = (event: object) => res.write(`${JSON.stringify(event)}\n`);

    // Si el navegador cierra la conexión antes de terminar, se cancela la llamada a Gemini.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const projectId = conversation.project_id as string;
    const title =
      conversation.title === DEFAULT_TITLE
        ? question.length > 60
          ? `${question.slice(0, 57)}…`
          : question
        : conversation.title;

    const finish = async (
      answer: string,
      sources: Source[],
      toolCalls: CatalogToolCall[],
      cached: boolean,
      modelInfo: ModelInfo | null,
      cacheMatch: CacheMatch | null,
    ) => {
      const saved = unwrap(
        await db
          .from('messages')
          .insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: answer,
            sources,
            tool_calls: toolCalls,
            model_info: modelInfo,
          })
          .select('id')
          .single(),
      );
      await db.from('conversations').update({ title }).eq('id', conversationId);
      emit({ type: 'done', messageId: saved.id, title, cached, cacheMatch });
    };

    let answer = '';
    try {
      const bot = this.chatbots.profile(await this.chatbots.findByProject(db, projectId), 'internal');
      const result = await this.engine.ask(
        { db, projectId, companyId: conversation.company_id, question, history: previous, bot, emit, signal: abort.signal, channel: 'app' },
        (partial) => (answer = partial),
      );
      answer = result.answer;
      await finish(result.answer, result.sources, result.toolCalls, result.cached, result.modelInfo, result.cacheMatch);
    } catch (err) {
      if (abort.signal.aborted) {
        this.logger.warn(`Cliente canceló la respuesta en ${conversationId}`);
      } else {
        this.logger.error(`Error en el chat ${conversationId}: ${(err as Error).message}`, (err as Error).stack);
        emit({
          type: 'error',
          message: err instanceof MissingModelKeyError ? err.message : 'No se pudo generar la respuesta. Intenta de nuevo.',
        });
      }
      if (answer) {
        await db
          .from('messages')
          .insert({ conversation_id: conversationId, role: 'assistant', content: `${answer}\n\n_(respuesta incompleta)_` });
      }
    } finally {
      res.end();
    }
  }
}
