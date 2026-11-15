import { Inject, Injectable } from '@nestjs/common';
import { ForbiddenError } from '../../domain/errors';
import {
  ACCESS_POLICY,
  PROJECT_REPOSITORY,
  type AccessPolicy,
  type CompanyRole,
  type DataScope,
  type ProjectRef,
  type ProjectRepository,
} from '../ports';

/**
 * Comprueba que el usuario ve un proyecto y qué rol tiene en su empresa.
 * Centraliza la regla que antes repetía cada controlador.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
  ) {}

  /** El proyecto (NotFoundError si no lo ve) y si el usuario tiene alguno de los roles. */
  async check(scope: DataScope, projectId: string, roles: readonly CompanyRole[]): Promise<{ project: ProjectRef; allowed: boolean }> {
    const project = await this.projects.ref(scope, projectId);
    return { project, allowed: await this.policy.hasRole(scope, project.companyId, roles) };
  }

  /** Como check, pero lanza ForbiddenError si no tiene el rol. */
  async require(
    scope: DataScope,
    projectId: string,
    roles: readonly CompanyRole[],
    message = 'No tienes permiso para esta acción',
  ): Promise<ProjectRef> {
    const { project, allowed } = await this.check(scope, projectId, roles);
    if (!allowed) throw new ForbiddenError(message);
    return project;
  }

  /** El usuario tiene alguno de los roles en la empresa. */
  hasRole(scope: DataScope, companyId: string, roles: readonly CompanyRole[]): Promise<boolean> {
    return this.policy.hasRole(scope, companyId, roles);
  }
}
