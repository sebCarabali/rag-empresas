import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { ForbiddenError } from '../../domain/errors';
import type { DataScope, FileStorage, SignedUpload } from '../../application/ports';
import { SupabaseService } from '../supabase/supabase.service';

/** Adaptador de FileStorage sobre el bucket de Supabase Storage de los documentos. */
@Injectable()
export class SupabaseFileStorage implements FileStorage {
  private readonly logger = new Logger(SupabaseFileStorage.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: AppConfig,
  ) {}

  private bucket(scope?: DataScope) {
    return (scope ? this.supabase.client(scope) : this.supabase.admin).storage.from(this.config.storageBucket);
  }

  async download(path: string): Promise<Buffer> {
    const { data, error } = await this.bucket().download(path);
    if (error || !data) throw new Error(error?.message ?? 'archivo vacío');
    return Buffer.from(await data.arrayBuffer());
  }

  async upload(path: string, data: string | Buffer, contentType: string): Promise<void> {
    const { error } = await this.bucket().upload(path, data, { contentType, upsert: true });
    if (error) throw new Error(error.message);
  }

  /** list es más fiable que exists/HEAD en Supabase Storage. */
  async exists(path: string): Promise<boolean> {
    const slash = path.lastIndexOf('/');
    const folder = path.slice(0, slash);
    const fileName = path.slice(slash + 1);
    const { data, error } = await this.bucket().list(folder, { search: fileName, limit: 10 });
    if (error) throw new Error(`No se pudo verificar el archivo en Storage: ${error.message}`);
    return Boolean(data?.some((f) => f.name === fileName));
  }

  async remove(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { error } = await this.bucket().remove(paths);
    if (error) this.logger.error(`No se pudieron borrar ${paths.length} archivos (${paths[0]}…): ${error.message}`);
  }

  async createSignedUpload(scope: DataScope, path: string): Promise<SignedUpload> {
    const { data, error } = await this.bucket(scope).createSignedUploadUrl(path);
    if (error || !data) throw new ForbiddenError(`No se pudo preparar la subida: ${error?.message}`);
    return { path: data.path, token: data.token, signedUrl: data.signedUrl };
  }
}
