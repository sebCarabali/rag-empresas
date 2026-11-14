import { Injectable } from '@nestjs/common';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

/**
 * Comprueba que la clave de servidor sea realmente secreta. Si por error se
 * configura la clave pública, Storage y la base aplican RLS como usuario
 * anónimo y las operaciones del worker fallan sin un error claro.
 */
function assertServiceKey(key: string): string {
  if (key.startsWith('sb_secret_')) return key;
  if (key.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY contiene la clave pública (sb_publishable_…); usa la secreta');
  }
  const [, payload] = key.split('.');
  if (payload) {
    try {
      const { role } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (role === 'service_role') return key;
      throw new Error(`SUPABASE_SERVICE_ROLE_KEY tiene rol "${role}"; debe ser service_role`);
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error('SUPABASE_SERVICE_ROLE_KEY no tiene un formato válido');
      throw err;
    }
  }
  throw new Error('SUPABASE_SERVICE_ROLE_KEY no tiene un formato válido (se espera sb_secret_… o un JWT)');
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
  readonly supabaseUrl = required('SUPABASE_URL').trim().replace(/\/$/, '');
  /** Clave pública (anon / publishable). Se usa con el JWT del usuario para que aplique RLS. */
  readonly supabaseAnonKey = required('SUPABASE_ANON_KEY').trim();
  /** Clave service_role. Solo la usa el worker y operaciones de Storage del servidor. */
  readonly supabaseServiceRoleKey = assertServiceKey(required('SUPABASE_SERVICE_ROLE_KEY').trim());

  readonly geminiApiKey = required('GEMINI_API_KEY').trim();
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
