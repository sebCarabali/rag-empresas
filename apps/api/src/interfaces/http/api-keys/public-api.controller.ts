import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { MissingModelKeyError } from '../../../infrastructure/secrets/vault-provider-key-store';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard';
import { ChatEngineService } from '../../../application/chat/chat-engine.service';
import type { ChatTurn } from '../../../infrastructure/llm/gemini-chat-model';
import { ChatbotsService } from '../../../application/chatbots/chatbots.service';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { ApiKeysService, TOKEN_MAX_TTL, type ApiKeyContext } from '../../../application/api-keys/api-keys.service';

class Turn {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content: string;
}

class ChatDto {
  @IsString()
  @Length(1, 4000)
  question: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => Turn)
  history?: Turn[];

  /** true: respuesta NDJSON en streaming (mismos eventos que el widget). */
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

class TokenDto {
  /** Segundos de validez (60 a 86400; 3600 por defecto). */
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(TOKEN_MAX_TTL)
  ttlSeconds?: number;

  /** Identificador del visitante en el sistema de la empresa (opcional). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  visitorId?: string;
}

/**
 * API para el servidor de la empresa, autenticada con una clave secreta
 * (`Authorization: Bearer sk_live_…`). Nunca debe usarse desde el navegador.
 */
@Public()
@Controller('v1')
export class PublicApiController {
  private readonly logger = new Logger(PublicApiController.name);

  constructor(
    private readonly keys: ApiKeysService,
    private readonly supabase: SupabaseService,
    private readonly engine: ChatEngineService,
    private readonly chatbots: ChatbotsService,
  ) {}

  /** Emite un token temporal para que el widget funcione en modo protegido. */
  @Post('widget-tokens')
  @HttpCode(201)
  async widgetToken(@Headers('authorization') auth: string | undefined, @Body() dto: TokenDto) {
    const ctx = await this.keys.authenticate(auth);
    if (!ctx.chatbot) throw new HttpException('El proyecto no tiene asistente configurado', HttpStatus.BAD_REQUEST);
    return this.keys.issueToken(ctx.chatbot.id, dto.ttlSeconds, dto.visitorId);
  }

  /** Pregunta al asistente del proyecto desde el servidor de la empresa. */
  @Post('chat')
  async chat(@Headers('authorization') auth: string | undefined, @Body() dto: ChatDto, @Res() res: Response) {
    const ctx = await this.keys.authenticate(auth);
    await this.enforceDailyLimit(ctx);

    const db = this.supabase.admin;
    const input = {
      db,
      projectId: ctx.projectId,
      companyId: ctx.companyId,
      question: dto.question.trim(),
      history: (dto.history ?? []) as ChatTurn[],
      bot: this.chatbots.profile(ctx.chatbot, 'public'),
      signal: new AbortController().signal,
      channel: 'api' as const,
    };

    if (!dto.stream) {
      const result = await this.engine.ask({ ...input, emit: () => undefined });
      res.status(200).json({
        answer: result.answer,
        sources: result.sources.map((s) => ({ index: s.index, document: s.documentName, page: s.page ?? null })),
        model: result.modelInfo ? { provider: result.modelInfo.provider, name: result.modelInfo.model, fallback: result.modelInfo.fallback } : null,
        cached: result.cached,
      });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.flushHeaders();
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const emit = (event: object) => res.write(`${JSON.stringify(event)}\n`);
    try {
      const result = await this.engine.ask({ ...input, emit, signal: abort.signal });
      emit({ type: 'done', cached: result.cached });
    } catch (err) {
      if (!abort.signal.aborted) {
        this.logger.error(`API ${ctx.keyId}: ${(err as Error).message}`);
        emit({ type: 'error', message: err instanceof MissingModelKeyError ? err.message : 'No se pudo generar la respuesta.' });
      }
    } finally {
      res.end();
    }
  }

  private async enforceDailyLimit(ctx: ApiKeyContext) {
    if (!ctx.chatbot) return;
    const { data: used, error } = await this.supabase.admin.rpc('widget_register_message', { p_chatbot_id: ctx.chatbot.id });
    if (error) throw new Error(error.message);
    if (Number(used) > ctx.chatbot.daily_message_limit) {
      throw new HttpException('Se alcanzó el límite diario de mensajes del asistente', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
