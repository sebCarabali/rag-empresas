import type { DataScope } from './data-scope';

export interface SignedUpload {
  path: string;
  token: string;
  signedUrl: string;
}

/** Puerto de salida: archivos de los documentos. */
export interface FileStorage {
  /** Lanza un error si no existe o no se pudo descargar. */
  download(path: string): Promise<Buffer>;
  upload(path: string, data: string | Buffer, contentType: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Borra lo que exista; registra (no lanza) si falla. */
  remove(paths: string[]): Promise<void>;
  /** URL para que el navegador suba el archivo directo. Con el scope del usuario se vuelven a validar sus permisos. */
  createSignedUpload(scope: DataScope, path: string): Promise<SignedUpload>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');
