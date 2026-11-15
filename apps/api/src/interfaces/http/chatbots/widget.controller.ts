import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
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
import { ChatEngineService } from '../../../application/chat/chat-engine.service';
import type { ChatTurn } from '../../../domain/llm/llm';
import { ApiKeysService } from '../../../application/api-keys/api-keys.service';
import { ChatbotsService } from '../../../application/chatbots/chatbots.service';
import { publicConfig, type ChatbotRow } from '../../../domain/chatbots/chatbot';
import {
  CHATBOT_REPOSITORY,
  SYSTEM_SCOPE,
  WIDGET_MESSAGE_REPOSITORY,
  type ChatbotRepository,
  type WidgetMessageRepository,
} from '../../../application/ports';

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
    @Inject(CHATBOT_REPOSITORY) private readonly bots: ChatbotRepository,
    @Inject(WIDGET_MESSAGE_REPOSITORY) private readonly widgetMessages: WidgetMessageRepository,
    private readonly chatbots: ChatbotsService,
    private readonly engine: ChatEngineService,
    private readonly keys: ApiKeysService,
  ) {}

  /** En modo protegido, cada petición del widget debe traer un token vigente emitido por la empresa. */
  private requireToken(bot: ChatbotRow, req: Request) {
    if (bot.widget_auth !== 'token') return;
    const token = String(req.headers['x-widget-token'] ?? '');
    if (!this.keys.checkToken(token, bot.id)) {
      throw new HttpException(
        { statusCode: 401, code: 'widget_token_invalid', message: 'La sesión del chat venció. Recarga la página.' },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private async enabledBot(publicKey: string): Promise<ChatbotRow> {
    const bot = await this.chatbots.findByPublicKey(publicKey);
    if (!bot || !bot.widget_enabled) throw new NotFoundException('Chatbot no disponible');
    return bot;
  }

  @Get(':publicKey/config')
  async config(@Param('publicKey') publicKey: string) {
    return publicConfig(await this.enabledBot(publicKey));
  }

  @Post(':publicKey/messages')
  async message(
    @Param('publicKey') publicKey: string,
    @Body() dto: WidgetMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const bot = await this.enabledBot(publicKey);
    this.requireToken(bot, req);

    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    if (!allowIp(`${bot.id}:${ip}`)) {
      throw new HttpException('Estás enviando mensajes muy rápido. Espera un momento.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if ((await this.bots.registerWidgetMessage(bot.id)) > bot.daily_message_limit) {
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
        scope: SYSTEM_SCOPE,
        projectId: bot.project_id,
        companyId: bot.company_id,
        question,
        history: (dto.history ?? []) as ChatTurn[],
        bot: this.chatbots.profile(bot, 'public'),
        emit,
        signal: abort.signal,
        channel: 'widget',
      });
      // Registro para que la empresa vea lo que preguntan sus visitantes.
      const messageId = await this.widgetMessages
        .log({
          chatbotId: bot.id,
          companyId: bot.company_id,
          projectId: bot.project_id,
          sessionId,
          question,
          answer: result.answer,
          modelInfo: result.modelInfo,
          cached: result.cached,
        })
        .catch((err: Error) => {
          this.logger.warn(`Widget ${bot.id}: no se registró el mensaje: ${err.message}`);
          return null;
        });
      emit({ type: 'done', cached: result.cached, messageId, sessionId });
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
    @Req() req: Request,
  ) {
    const bot = await this.enabledBot(publicKey);
    this.requireToken(bot, req);
    const rated = await this.widgetMessages.rate({
      chatbotId: bot.id,
      sessionId: dto.sessionId,
      messageId,
      rating: dto.rating,
      comment: dto.comment?.trim() || null,
    });
    if (!rated) throw new NotFoundException('Mensaje no encontrado');
    return rated;
  }
}
