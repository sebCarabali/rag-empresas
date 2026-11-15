import { Body, Controller, Delete, Get, HttpCode, Logger, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../supabase-error';
import { AppConfig } from '../../../infrastructure/config/app-config';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';

class CreateProjectDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

const PROJECT_COLUMNS = 'id, company_id, name, description, created_at, updated_at';

@Controller()
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
  ) {}

  @Get('companies/:companyId/projects')
  async list(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db
        .from('projects')
        .select(PROJECT_COLUMNS)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false }),
    );
  }

  @Post('companies/:companyId/projects')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateProjectDto,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db
        .from('projects')
        .insert({ company_id: companyId, name: dto.name, description: dto.description ?? null })
        .select(PROJECT_COLUMNS)
        .single(),
    );
  }

  @Get('projects/:projectId')
  async get(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db.from('projects').select(PROJECT_COLUMNS).eq('id', projectId).single(),
      'Proyecto no encontrado',
    );
  }

  @Patch('projects/:projectId')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    return unwrap(
      await db.from('projects').update(dto).eq('id', projectId).select(PROJECT_COLUMNS).single(),
      'Proyecto no encontrado o sin permiso',
    );
  }

  /** Elimina el proyecto (documentos, chunks y chats caen en cascada) y sus archivos. */
  @Delete('projects/:projectId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const db = this.supabase.forUser(user.accessToken);

    const docs = unwrap(await db.from('documents').select('storage_path').eq('project_id', projectId));

    const deleted = unwrap(
      await db.from('projects').delete().eq('id', projectId).select('id').single(),
      'Proyecto no encontrado o sin permiso',
    );

    // Solo después de confirmar que RLS permitió borrar, se limpian los archivos.
    if (deleted && docs.length > 0) {
      const { error } = await this.supabase.admin.storage
        .from(this.config.storageBucket)
        .remove(docs.map((d) => d.storage_path));
      if (error) this.logger.error(`No se pudieron borrar archivos del proyecto ${projectId}: ${error.message}`);
    }
  }
}
