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
import { AnswerCacheService } from './answer-cache.service';
import { createCatalogExecutor, loadCatalogContext, type CatalogToolCall } from './catalog-tools';
import { loadEnrichments } from './enrichment-context';
import {
  buildUserTurn,
  diversify,
  SYSTEM_INSTRUCTION,
  toSources,
  type ExtraContext,
  type RetrievedChunk,
  type Source,
} from './prompt';

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
/** Candidatos que se piden a la búsqueda antes de diversificar. */
const MATCH_CANDIDATES = 30;
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
    private readonly cache: AnswerCacheService,
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
        .select('id, role, content, sources, tool_calls, created_at')
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

    const projectId = conversation.project_id as string;
    const title =
      conversation.title === DEFAULT_TITLE
        ? question.length > 60
          ? `${question.slice(0, 57)}…`
          : question
        : conversation.title;

    const finish = async (answer: string, sources: Source[], toolCalls: CatalogToolCall[], cached: boolean) => {
      const saved = unwrap(
        await db
          .from('messages')
          .insert({ conversation_id: conversationId, role: 'assistant', content: answer, sources, tool_calls: toolCalls })
          .select('id')
          .single(),
      );
      await db.from('conversations').update({ title }).eq('id', conversationId);
      emit({ type: 'done', messageId: saved.id, title, cached });
    };

    let answer = '';
    try {
      // 1) Caché: cualquier pregunta que se entienda sola (no las de seguimiento).
      let cacheKey: string | null = null;
      if (this.cache.enabled && !AnswerCacheService.isFollowUp(question, previous.length > 0)) {
        const version = await this.cache.contentVersion(db, projectId);
        cacheKey = this.cache.key(projectId, version, question);
        const hit = await this.cache.get(cacheKey);
        if (hit) {
          emit({ type: 'sources', sources: hit.sources });
          for (const call of hit.toolCalls) emit({ type: 'tool', call });
          emit({ type: 'delta', text: hit.answer });
          await finish(hit.answer, hit.sources, hit.toolCalls, true);
          return;
        }
      }

      // 2) Búsqueda híbrida, diversificada para que un producto no acapare el contexto.
      const queryEmbedding = await this.embeddings.embedQuery(question);
      const { data: matches, error } = await db.rpc('match_document_chunks', {
        p_project_id: projectId,
        query_embedding: toPgVector(queryEmbedding),
        query_text: question,
        match_count: MATCH_CANDIDATES,
      });
      if (error) throw new Error(`Búsqueda: ${error.message}`);

      const chunks = diversify((matches ?? []) as RetrievedChunk[], MATCH_COUNT);
      const sources = toSources(chunks);

      // Descripciones generales (web) de las familias de tela que aparecen en la pregunta o los resultados.
      const enrichments = await loadEnrichments(db, projectId, question, chunks);
      const extras: ExtraContext[] = enrichments.map((e) => ({
        label: `${e.field} "${e.value}" — descripción general (web)`,
        content: e.description,
      }));
      enrichments.forEach((e) =>
        sources.push({
          index: sources.length + 1,
          documentId: '',
          documentName: `${e.field}: ${e.value} — descripción general (web)`,
          chunkIndex: -1,
          snippet: e.description.length > 280 ? `${e.description.slice(0, 280)}…` : e.description,
          kind: 'web',
          links: e.sources,
        }),
      );
      emit({ type: 'sources', sources });

      // 3) Herramientas de catálogo (filtros exactos, conteos, rankings) si hay CSV procesados.
      const catalog = await loadCatalogContext(db, projectId);
      const toolCalls: CatalogToolCall[] = [];
      const execute = catalog ? createCatalogExecutor(db, projectId, sources, toolCalls) : undefined;
      const systemInstruction = catalog ? `${SYSTEM_INSTRUCTION}\n${catalog.instructions}` : SYSTEM_INSTRUCTION;

      const turns: ChatTurn[] = [...previous, { role: 'user', content: buildUserTurn(question, chunks, extras) }];
      for await (const event of this.gemini.run(systemInstruction, turns, {
        tools: catalog?.declarations,
        execute,
        signal: abort.signal,
      })) {
        if (event.type === 'text') {
          answer += event.text;
          emit({ type: 'delta', text: event.text });
        } else {
          emit({ type: 'tool', call: toolCalls[toolCalls.length - 1] });
          // Las fuentes del catálogo se agregan a medida que el modelo consulta.
          emit({ type: 'sources', sources });
        }
      }

      await finish(answer, sources, toolCalls, false);
      if (cacheKey && answer.trim()) {
        await this.cache.put(cacheKey, projectId, question, { answer, sources, toolCalls });
      }
    } catch (err) {
      if (abort.signal.aborted) {
        this.logger.warn(`Cliente canceló la respuesta en ${conversationId}`);
      } else {
        this.logger.error(`Error en el chat ${conversationId}: ${(err as Error).message}`, (err as Error).stack);
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
