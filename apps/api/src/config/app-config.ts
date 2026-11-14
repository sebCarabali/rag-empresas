import { Injectable } from '@nestjs/common';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/**
 * Configuración tipada leída de variables de entorno.
 * Se valida al arrancar: si falta algo, la función falla de inmediato.
 */
@Injectable()
export class AppConfig {
  readonly supabaseUrl = required('SUPABASE_URL');
  /** Clave pública (anon / publishable). Se usa con el JWT del usuario para que aplique RLS. */
  readonly supabaseAnonKey = required('SUPABASE_ANON_KEY');
  /** Clave service_role. Solo la usa el worker y operaciones de Storage del servidor. */
  readonly supabaseServiceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');

  readonly geminiApiKey = required('GEMINI_API_KEY');
  readonly geminiModel = optional('GEMINI_MODEL', 'gemini-3.5-flash');

  readonly embeddingModel = optional('EMBEDDING_MODEL', 'Xenova/multilingual-e5-small');
  /** Dimensión del vector: debe coincidir con document_chunks.embedding. */
  readonly embeddingDimensions = 384;

  readonly webOrigins = optional('WEB_ORIGIN', 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  readonly ingestionTopic = optional('INGESTION_TOPIC', 'document-ingestion');
  readonly storageBucket = 'documents';

  /**
   * En local no hay Vercel Queues: si es true, el documento se procesa en el
   * mismo proceso justo después de encolarlo. Por defecto, true fuera de Vercel.
   */
  readonly ingestInline = optional('INGEST_INLINE', process.env.VERCEL ? 'false' : 'true') === 'true';

  readonly maxUploadBytes = 50 * 1024 * 1024;
}
