import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import { ChatbotsService } from '../../../application/chatbots/chatbots.service';
import { ApiKeysService } from '../../../application/api-keys/api-keys.service';
import { ProjectAccessService } from '../../../application/access/project-access.service';
import {
  ADMIN_ROLES,
  API_KEY_REPOSITORY,
  type ApiKeyRepository,
  type DataScope,
  type ProjectRef,
} from '../../../application/ports';

class CreateKeyDto {
  @IsString()
  @Length(1, 60)
  name: string;
}

const ADMIN_ONLY = 'Solo owner o admin pueden administrar las claves de API';

/** Administración de claves secretas de API del proyecto (owner/admin). */
@Controller('projects/:projectId')
export class ApiKeysController {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly repository: ApiKeyRepository,
    private readonly keys: ApiKeysService,
    private readonly chatbots: ChatbotsService,
    private readonly access: ProjectAccessService,
  ) {}

  private async requireAdmin(user: AuthUser, projectId: string): Promise<{ scope: DataScope; project: ProjectRef }> {
    const scope = scopeOf(user);
    return { scope, project: await this.access.require(scope, projectId, ADMIN_ROLES, ADMIN_ONLY) };
  }

  @Get('api-keys')
  async list(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const { scope } = await this.requireAdmin(user, projectId);
    return this.repository.list(scope, projectId);
  }

  /** Genera una clave. Es la única vez que se devuelve completa: solo se guarda su hash. */
  @Post('api-keys')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateKeyDto,
  ) {
    const { project } = await this.requireAdmin(user, projectId);
    return this.keys.create(project, dto.name, user.id);
  }

  @Delete('api-keys/:keyId')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
  ) {
    await this.requireAdmin(user, projectId);
    await this.repository.revoke(projectId, keyId);
  }

  /** Token de prueba del widget (1 h), para validar la instalación sin servidor propio. */
  @Post('chatbot/test-token')
  async testToken(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const { scope } = await this.requireAdmin(user, projectId);
    const bot = await this.chatbots.findByProject(scope, projectId);
    if (!bot) throw new BadRequestException('Primero guarda la configuración del asistente');
    return this.keys.issueToken(bot.id, 3600, 'prueba');
  }
}
