import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';
import { CHATBOT_COLUMNS, ChatbotsService, DEFAULT_CHATBOT } from './chatbots.service';

class ChatbotDto {
  @IsString()
  @Length(1, 60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  welcome_message?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string | null;

  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  suggested_questions: string[];

  @IsHexColor()
  primary_color: string;

  @IsOptional()
  @Matches(/^https:\/\/\S+$/, { message: 'El logo debe ser una URL https' })
  avatar_url?: string | null;

  @IsIn(['auto', 'es', 'en', 'pt'])
  language: 'auto' | 'es' | 'en' | 'pt';

  @IsBoolean()
  widget_enabled: boolean;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  allowed_origins: string[];

  @IsInt()
  @Min(1)
  @Max(100000)
  daily_message_limit: number;

  @IsBoolean()
  widget_show_sources: boolean;

  /** public: clave pública + dominios · token: además exige un token del servidor de la empresa. */
  @IsIn(['public', 'token'])
  widget_auth: 'public' | 'token';
}

/** "empresa.com/tienda" → "https://empresa.com"; valida que sea un origen web. */
export function normalizeOrigin(value: string): string {
  const raw = value.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new BadRequestException(`Dominio no válido: ${value}`);
  }
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
    throw new BadRequestException(`Dominio no válido: ${value}`);
  }
  return url.origin;
}

@Controller('projects/:projectId/chatbot')
export class ChatbotsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly chatbots: ChatbotsService,
  ) {}

  /** Configuración del asistente del proyecto (valores por defecto si aún no existe). */
  @Get()
  async get(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(await db.from('projects').select('id, company_id').eq('id', projectId).single(), 'Proyecto no encontrado');
    const bot = await this.chatbots.findByProject(db, projectId);
    const today = bot
      ? (await db.from('widget_usage').select('messages').eq('chatbot_id', bot.id).eq('day', new Date().toISOString().slice(0, 10)).maybeSingle()).data
      : null;
    const canEdit = unwrap(
      await db.rpc('has_company_role', { p_company_id: project.company_id, p_roles: ['owner', 'admin'] }),
    );
    return {
      exists: Boolean(bot),
      canEdit,
      messagesToday: today?.messages ?? 0,
      chatbot: bot ?? { ...DEFAULT_CHATBOT, project_id: projectId, public_key: null },
    };
  }

  /** Crea o actualiza la configuración (owner/admin; lo exige RLS). */
  @Put()
  async save(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ChatbotDto,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(await db.from('projects').select('id, company_id').eq('id', projectId).single(), 'Proyecto no encontrado');
    const values = {
      ...dto,
      welcome_message: dto.welcome_message?.trim() || null,
      instructions: dto.instructions?.trim() || null,
      avatar_url: dto.avatar_url?.trim() || null,
      suggested_questions: dto.suggested_questions.map((q) => q.trim()).filter(Boolean),
      allowed_origins: [...new Set(dto.allowed_origins.filter((o) => o.trim()).map(normalizeOrigin))],
    };
    if (values.widget_enabled && values.allowed_origins.length === 0) {
      throw new BadRequestException('Agrega al menos un dominio autorizado para activar el widget.');
    }
    const existing = await this.chatbots.findByProject(db, projectId);
    const result = existing
      ? await db.from('chatbots').update(values).eq('id', existing.id).select(CHATBOT_COLUMNS).single()
      : await db
          .from('chatbots')
          .insert({ ...values, project_id: projectId, company_id: project.company_id })
          .select(CHATBOT_COLUMNS)
          .single();
    return unwrap(result, 'Solo owner o admin pueden configurar el asistente');
  }

  /** Genera una clave pública nueva (la anterior deja de funcionar en los sitios). */
  @Post('rotate-key')
  async rotateKey(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    const bot = await this.chatbots.findByProject(db, projectId);
    if (!bot) throw new BadRequestException('Primero guarda la configuración del asistente');
    const public_key = `bot_${randomBytes(16).toString('hex')}`;
    return unwrap(
      await db.from('chatbots').update({ public_key }).eq('id', bot.id).select(CHATBOT_COLUMNS).single(),
      'Solo owner o admin pueden cambiar la clave',
    );
  }
}
