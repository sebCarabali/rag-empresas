import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { ParseUUIDPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth.guard';
import { ChatEngineService } from '../chat/chat-engine.service';
import type { ChatTurn } from '../chat/gemini.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ChatbotsService, publicConfig } from './chatbots.service';

class HistoryTurn {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content: string;
}

class WidgetMessageDto {
  @IsString()
  @Length(1, 1000)
  content: string;

  /** Historial reciente que guarda el navegador del visitante (el servidor no lo persiste). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => HistoryTurn)
  history?: HistoryTurn[];

  /** Sesión del visitante (aleatoria, la genera el navegador) para agrupar sus preguntas. */
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

class WidgetFeedbackDto {
  @IsUUID()
  sessionId: string;

  @IsInt()
  @IsIn([-1, 1])
  rating: -1 | 1;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

/** Mensajes por minuto que puede enviar un mismo visitante (IP) por instancia. */
const PER_IP_PER_MINUTE = 10;
const ipHits = new Map<string, number[]>();

function allowIp(ip: string): boolean {
  const now = Date.now();
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_IP_PER_MINUTE) {
    ipHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  ipHits.set(ip, recent);
  if (ipHits.size > 10_000) ipHits.clear(); // evita crecer sin límite
  return true;
}

/**
 * API pública del widget que las empresas insertan en su sitio web.
 * No requiere sesión: se identifica con la clave pública del chatbot y solo
 * accede a los documentos de su proyecto. Tiene límite por visitante y tope
 * diario de mensajes por chatbot para controlar el costo.
 */
@Public()
@Controller('widget')
export class WidgetController {
  private readonly logger = new Logger(WidgetController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly chatbots: ChatbotsService,
    private readonly engine: ChatEngineService,
  ) {}

  @Get(':publicKey/config')
  async config(@Param('publicKey') publicKey: string) {
    const bot = await this.chatbots.findByPublicKey(this.supabase.admin, publicKey);
    if (!bot || !bot.widget_enabled) throw new NotFoundException('Chatbot no disponible');
    return publicConfig(bot);
  }

  @Post(':publicKey/messages')
  async message(
    @Param('publicKey') publicKey: string,
    @Body() dto: WidgetMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const db = this.supabase.admin;
    const bot = await this.chatbots.findByPublicKey(db, publicKey);
    if (!bot || !bot.widget_enabled) throw new NotFoundException('Chatbot no disponible');

    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    if (!allowIp(`${bot.id}:${ip}`)) {
      throw new HttpException('Estás enviando mensajes muy rápido. Espera un momento.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const { data: used, error: usageError } = await db.rpc('widget_register_message', { p_chatbot_id: bot.id });
    if (usageError) throw new Error(usageError.message);
    if (Number(used) > bot.daily_message_limit) {
      throw new HttpException(
        'El asistente alcanzó su límite de mensajes por hoy. Vuelve a intentarlo mañana.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Si la empresa no quiere mostrar fuentes, no se envían fragmentos de sus documentos al navegador.
    const emit = (event: object) => {
      const type = (event as { type?: string }).type;
      if (!bot.widget_show_sources && (type === 'sources' || type === 'tool')) return;
      if (type === 'model') return; // detalle interno, no se muestra a visitantes
      res.write(`${JSON.stringify(event)}\n`);
    };

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const sessionId = dto.sessionId ?? randomUUID();
    const question = dto.content.trim();
    try {
      const result = await this.engine.ask({
        db,
        projectId: bot.project_id,
        companyId: bot.company_id,
        question,
        history: (dto.history ?? []) as ChatTurn[],
        bot: this.chatbots.profile(bot, 'public'),
        emit,
        signal: abort.signal,
      });
      // Registro para que la empresa vea lo que preguntan sus visitantes.
      const { data: logged, error: logError } = await db
        .from('widget_messages')
        .insert({
          chatbot_id: bot.id,
          company_id: bot.company_id,
          project_id: bot.project_id,
          session_id: sessionId,
          question,
          answer: result.answer,
          model_info: result.modelInfo,
          cached: result.cached,
        })
        .select('id')
        .single();
      if (logError) this.logger.warn(`Widget ${bot.id}: no se registró el mensaje: ${logError.message}`);
      emit({ type: 'done', cached: result.cached, messageId: logged?.id ?? null, sessionId });
    } catch (err) {
      if (!abort.signal.aborted) {
        this.logger.error(`Widget ${bot.id}: ${(err as Error).message}`);
        emit({ type: 'error', message: 'No pude responder en este momento. Intenta de nuevo.' });
      }
    } finally {
      res.end();
    }
  }

  /** 👍/👎 del visitante. Solo puede valorar respuestas de su propia sesión. */
  @Post(':publicKey/messages/:messageId/feedback')
  async feedback(
    @Param('publicKey') publicKey: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: WidgetFeedbackDto,
  ) {
    const db = this.supabase.admin;
    const bot = await this.chatbots.findByPublicKey(db, publicKey);
    if (!bot || !bot.widget_enabled) throw new NotFoundException('Chatbot no disponible');
    const { data, error } = await db
      .from('widget_messages')
      .update({ rating: dto.rating, feedback_comment: dto.comment?.trim() || null, feedback_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('chatbot_id', bot.id)
      .eq('session_id', dto.sessionId)
      .select('id, rating')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Mensaje no encontrado');
    return data;
  }
}
