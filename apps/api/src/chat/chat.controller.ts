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
import { EmbeddingsService, toPgVector } from '../embeddings/embeddings.service';
import { SupabaseService } from '../supabase/supabase.service';
import { GeminiService, type ChatTurn } from './gemini.service';
import { buildUserTurn, SYSTEM_INSTRUCTION, toSources, type RetrievedChunk } from './prompt';

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

/** Fragmentos que se recuperan por pregunta. */
const MATCH_COUNT = 10;
/** Mensajes previos que se envían al modelo como historial. */
const HISTORY_LIMIT = 10;
const DEFAULT_TITLE = 'Nueva conversación';

@Controller()
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly embeddings: EmbeddingsService,
    private readonly gemini: GeminiService,
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
        .select('id, role, content, sources, created_at')
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
   * Pregunta → embedding → búsqueda híbrida (con RLS) → Gemini en streaming.
   * Responde NDJSON (una línea JSON por evento):
   *   {"type":"sources","sources":[...]}
   *   {"type":"delta","text":"..."}            (varias)
   *   {"type":"done","messageId":"..."}
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
      await db.from('conversations').select('id, project_id, title').eq('id', conversationId).single(),
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

    let answer = '';
    try {
      const queryEmbedding = await this.embeddings.embedQuery(question);
      const { data: matches, error } = await db.rpc('match_document_chunks', {
        p_project_id: conversation.project_id,
        query_embedding: toPgVector(queryEmbedding),
        query_text: question,
        match_count: MATCH_COUNT,
      });
      if (error) throw new Error(`Búsqueda: ${error.message}`);

      const chunks = (matches ?? []) as RetrievedChunk[];
      const sources = toSources(chunks);
      emit({ type: 'sources', sources });

      const turns: ChatTurn[] = [...previous, { role: 'user', content: buildUserTurn(question, chunks) }];
      for await (const text of this.gemini.stream(SYSTEM_INSTRUCTION, turns, abort.signal)) {
        answer += text;
        emit({ type: 'delta', text });
      }

      const saved = unwrap(
        await db
          .from('messages')
          .insert({ conversation_id: conversationId, role: 'assistant', content: answer, sources })
          .select('id')
          .single(),
      );

      // El título de la conversación sale de la primera pregunta.
      const title =
        conversation.title === DEFAULT_TITLE
          ? question.length > 60
            ? `${question.slice(0, 57)}…`
            : question
          : conversation.title;
      await db.from('conversations').update({ title }).eq('id', conversationId);

      emit({ type: 'done', messageId: saved.id, title });
    } catch (err) {
      if (abort.signal.aborted) {
        this.logger.warn(`Cliente canceló la respuesta en ${conversationId}`);
      } else {
        this.logger.error(`Error en el chat ${conversationId}`, err as Error);
        emit({ type: 'error', message: 'No se pudo generar la respuesta. Intenta de nuevo.' });
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
