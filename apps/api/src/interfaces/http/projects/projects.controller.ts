import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import { PROJECT_REPOSITORY, type ProjectRepository } from '../../../application/ports';
import { ProjectsService } from '../../../application/projects/projects.service';

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

@Controller()
export class ProjectsController {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    private readonly service: ProjectsService,
  ) {}

  @Get('companies/:companyId/projects')
  list(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.projects.list(scopeOf(user), companyId);
  }

  @Post('companies/:companyId/projects')
  create(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(scopeOf(user), { companyId, name: dto.name, description: dto.description ?? null });
  }

  @Get('projects/:projectId')
  get(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projects.get(scopeOf(user), projectId);
  }

  @Patch('projects/:projectId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(scopeOf(user), projectId, dto);
  }

  /** Elimina el proyecto (documentos, chunks y chats caen en cascada) y sus archivos. */
  @Delete('projects/:projectId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    await this.service.remove(scopeOf(user), projectId);
  }
}
