import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import { MissingModelKeyError, type ModelInfo } from '../../../domain/llm/llm';
import { ChatbotsService } from '../../../application/chatbots/chatbots.service';
import { ChatEngineService, type CacheMatch } from '../../../application/chat/chat-engine.service';
import {
  CONVERSATION_REPOSITORY,
  type CatalogToolCall,
  type ConversationRepository,
  type ProjectRepository,
  PROJECT_REPOSITORY,
} from '../../../application/ports';
import type { Source } from '../../../domain/chat/prompt';

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
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    private readonly engine: ChatEngineService,
    private readonly chatbots: ChatbotsService,
  ) {}

  @Get('projects/:projectId/conversations')
  list(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.conversations.list(scopeOf(user), projectId);
  }

  @Post('projects/:projectId/conversations')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateConversationDto,
  ) {
    const scope = scopeOf(user);
    const project = await this.projects.ref(scope, projectId);
    return this.conversations.create(scope, { projectId: project.id, companyId: project.companyId, title: dto.title || DEFAULT_TITLE });
  }

  @Get('conversations/:conversationId/messages')
  messages(@CurrentUser() user: AuthUser, @Param('conversationId', ParseUUIDPipe) id: string) {
    return this.conversations.messages(scopeOf(user), id);
  }

  @Delete('conversations/:conversationId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('conversationId', ParseUUIDPipe) id: string) {
    await this.conversations.delete(scopeOf(user), id);
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
    const scope = scopeOf(user);
    const question = dto.content.trim();

    // Validaciones antes de abrir el stream, para responder con códigos HTTP normales.
    const conversation = await this.conversations.get(scope, conversationId);
    const previous = await this.conversations.recentTurns(scope, conversationId, HISTORY_LIMIT);
    await this.conversations.addMessage(scope, { conversationId, role: 'user', content: question });

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

    const projectId = conversation.project_id;
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
      const messageId = await this.conversations.addMessage(scope, {
        conversationId,
        role: 'assistant',
        content: answer,
        sources,
        toolCalls,
        modelInfo,
      });
      await this.conversations.rename(scope, conversationId, title);
      emit({ type: 'done', messageId, title, cached, cacheMatch });
    };

    let answer = '';
    try {
      const bot = this.chatbots.profile(await this.chatbots.findByProject(scope, projectId), 'internal');
      const result = await this.engine.ask(
        { scope, projectId, companyId: conversation.company_id, question, history: previous, bot, emit, signal: abort.signal, channel: 'app' },
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
        await this.conversations
          .addMessage(scope, { conversationId, role: 'assistant', content: `${answer}\n\n_(respuesta incompleta)_` })
          .catch(() => undefined);
      }
    } finally {
      res.end();
    }
  }
}
