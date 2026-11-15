import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { ChatbotsService } from '../../../application/chatbots/chatbots.service';
import { unwrap } from '../supabase-error';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { ApiKeysService, generateKey } from '../../../application/api-keys/api-keys.service';

class CreateKeyDto {
  @IsString()
  @Length(1, 60)
  name: string;
}

const KEY_COLUMNS = 'id, name, prefix, last4, created_at, last_used_at, revoked_at';
/** Claves activas por proyecto. */
const MAX_ACTIVE_KEYS = 10;

/** Administración de claves secretas de API del proyecto (owner/admin). */
@Controller('projects/:projectId')
export class ApiKeysController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly keys: ApiKeysService,
    private readonly chatbots: ChatbotsService,
  ) {}

  private async requireAdmin(user: AuthUser, projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(
      await db.from('projects').select('id, company_id').eq('id', projectId).single(),
      'Proyecto no encontrado',
    );
    const { data: allowed } = await db.rpc('has_company_role', {
      p_company_id: project.company_id,
      p_roles: ['owner', 'admin'],
    });
    if (!allowed) throw new ForbiddenException('Solo owner o admin pueden administrar las claves de API');
    return { db, project };
  }

  @Get('api-keys')
  async list(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const { db } = await this.requireAdmin(user, projectId);
    return unwrap(
      await db.from('api_keys').select(KEY_COLUMNS).eq('project_id', projectId).order('created_at', { ascending: false }),
    );
  }

  /** Genera una clave. Es la única vez que se devuelve completa: solo se guarda su hash. */
  @Post('api-keys')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateKeyDto,
  ) {
    const { project } = await this.requireAdmin(user, projectId);
    const admin = this.supabase.admin;
    const { count } = await admin
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('revoked_at', null);
    if ((count ?? 0) >= MAX_ACTIVE_KEYS) throw new BadRequestException(`Máximo ${MAX_ACTIVE_KEYS} claves activas por proyecto`);

    const { key, prefix, last4, hash } = generateKey();
    const row = unwrap(
      await admin
        .from('api_keys')
        .insert({
          company_id: project.company_id,
          project_id: projectId,
          name: dto.name.trim(),
          prefix,
          last4,
          key_hash: hash,
          created_by: user.id,
        })
        .select(KEY_COLUMNS)
        .single(),
    );
    return { ...row, key };
  }

  @Delete('api-keys/:keyId')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
  ) {
    await this.requireAdmin(user, projectId);
    unwrap(
      await this.supabase.admin
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', keyId)
        .eq('project_id', projectId)
        .is('revoked_at', null)
        .select('id')
        .single(),
      'Clave no encontrada o ya revocada',
    );
  }

  /** Token de prueba del widget (1 h), para validar la instalación sin servidor propio. */
  @Post('chatbot/test-token')
  async testToken(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const { db } = await this.requireAdmin(user, projectId);
    const bot = await this.chatbots.findByProject(db, projectId);
    if (!bot) throw new BadRequestException('Primero guarda la configuración del asistente');
    return this.keys.issueToken(bot.id, 3600, 'prueba');
  }
}
