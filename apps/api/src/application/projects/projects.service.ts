import { Inject, Injectable } from '@nestjs/common';
import {
  DOCUMENT_REPOSITORY,
  FILE_STORAGE,
  PROJECT_REPOSITORY,
  type DataScope,
  type DocumentRepository,
  type FileStorage,
  type ProjectRepository,
} from '../ports';

/** Casos de uso de proyectos que tocan más de un recurso. */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepository,
    @Inject(FILE_STORAGE) private readonly files: FileStorage,
  ) {}

  /** Elimina el proyecto (documentos, fragmentos y chats caen en cascada) y sus archivos. */
  async remove(scope: DataScope, projectId: string): Promise<void> {
    const paths = await this.documents.storagePaths(scope, projectId);
    await this.projects.delete(scope, projectId);
    // Solo después de confirmar que los permisos dejaron borrar, se limpian los archivos.
    await this.files.remove(paths);
  }
}
