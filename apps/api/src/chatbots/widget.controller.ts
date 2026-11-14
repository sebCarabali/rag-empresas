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
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
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

    try {
      const result = await this.engine.ask({
        db,
        projectId: bot.project_id,
        companyId: bot.company_id,
        question: dto.content.trim(),
        history: (dto.history ?? []) as ChatTurn[],
        bot: this.chatbots.profile(bot, 'public'),
        emit,
        signal: abort.signal,
      });
      emit({ type: 'done', cached: result.cached });
    } catch (err) {
      if (!abort.signal.aborted) {
        this.logger.error(`Widget ${bot.id}: ${(err as Error).message}`);
        emit({ type: 'error', message: 'No pude responder en este momento. Intenta de nuevo.' });
      }
    } finally {
      res.end();
    }
  }
}
