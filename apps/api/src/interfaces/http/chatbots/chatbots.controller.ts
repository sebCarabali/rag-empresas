import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
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
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import { DEFAULT_CHATBOT } from '../../../domain/chatbots/chatbot';
import { ProjectAccessService } from '../../../application/access/project-access.service';
import {
  ADMIN_ROLES,
  CHATBOT_REPOSITORY,
  PROJECT_REPOSITORY,
  type ChatbotRepository,
  type ProjectRepository,
} from '../../../application/ports';

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
    @Inject(CHATBOT_REPOSITORY) private readonly bots: ChatbotRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    private readonly access: ProjectAccessService,
  ) {}

  /** Configuración del asistente del proyecto (valores por defecto si aún no existe). */
  @Get()
  async get(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const scope = scopeOf(user);
    const { allowed: canEdit } = await this.access.check(scope, projectId, ADMIN_ROLES);
    const bot = await this.bots.findByProject(scope, projectId);
    return {
      exists: Boolean(bot),
      canEdit,
      messagesToday: bot ? await this.bots.messagesToday(scope, bot.id) : 0,
      chatbot: bot ?? { ...DEFAULT_CHATBOT, project_id: projectId, public_key: null },
    };
  }

  /** Crea o actualiza la configuración (owner/admin; lo exigen los permisos de la base). */
  @Put()
  async save(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ChatbotDto,
  ) {
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
    const scope = scopeOf(user);
    return this.bots.save(scope, await this.projects.ref(scope, projectId), values);
  }

  /** Genera una clave pública nueva (la anterior deja de funcionar en los sitios). */
  @Post('rotate-key')
  async rotateKey(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const scope = scopeOf(user);
    const bot = await this.bots.findByProject(scope, projectId);
    if (!bot) throw new BadRequestException('Primero guarda la configuración del asistente');
    return this.bots.setPublicKey(scope, bot.id, `bot_${randomBytes(16).toString('hex')}`);
  }
}
