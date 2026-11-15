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

  readonly geminiModel = optional('GEMINI_MODEL', 'gemini-3.5-flash');

  /** Modelo por defecto de Groq (la clave la pone cada asistente). */
  readonly groqModel = optional('GROQ_MODEL', 'openai/gpt-oss-120b');
  /** false desactiva el modelo de respaldo en toda la plataforma. */
  readonly llmFallback = optional('LLM_FALLBACK', 'true') === 'true';

  /** Modelo por defecto de OpenAI (la clave la pone cada asistente). */
  readonly openaiModel = optional('OPENAI_MODEL', 'gpt-5.4-mini');
  /** Modelo por defecto de Mistral (la clave la pone cada asistente). */
  readonly mistralModel = optional('MISTRAL_MODEL', 'mistral-medium-latest');

  /** Modelo por defecto de cada proveedor. */
  get defaultModels(): Record<'gemini' | 'groq' | 'openai' | 'mistral', string> {
    return { gemini: this.geminiModel, groq: this.groqModel, openai: this.openaiModel, mistral: this.mistralModel };
  }
  /** Si el modelo principal no empieza a responder en este tiempo, se pasa al respaldo. */
  readonly geminiFirstEventTimeoutMs = Number(optional('GEMINI_FIRST_EVENT_TIMEOUT_MS', '25000'));

  /**
   * Modelo de embeddings por defecto de los proyectos (cada asistente puede elegir
   * otro en «Modelos»). Cambiarlo reindexa los proyectos que usan el valor por defecto.
   */
  readonly embeddingModel = optional('EMBEDDING_MODEL', 'Xenova/multilingual-e5-base');
  /** Precisión del modelo de embeddings: q8 (cuantizado, rápido) o fp32. */
  readonly embeddingDtype = optional('EMBEDDING_DTYPE', 'q8');

  /**
   * Reordenador (cross-encoder) aplicado a los candidatos de la búsqueda antes
   * de elegir los fragmentos que van al modelo. Licencia Apache 2.0.
   */
  readonly reranker = {
    enabled: optional('RERANKER_ENABLED', 'true') === 'true',
    model: optional('RERANKER_MODEL', 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'),
    /** Archivo ONNX dentro de onnx/ (sin extensión). Vacío = model.onnx. */
    modelFile: (process.env.RERANKER_MODEL_FILE ?? 'model_quint8_avx2').trim(),
    dtype: optional('RERANKER_DTYPE', 'fp32'),
    maxLength: Number(optional('RERANKER_MAX_TOKENS', '384')),
    /** Si el reordenador no termina en este tiempo, se usa el orden de la búsqueda. */
    timeoutMs: Number(optional('RERANKER_TIMEOUT_MS', '6000')),
    /** Candidatos que se reordenan. */
    candidates: Math.min(30, Math.max(10, Number(optional('RERANKER_CANDIDATES', '30')))),
  };

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

  /** Descripciones web (Gemini + Google Search) de familias de producto al procesar CSV. */
  readonly webEnrichment = optional('WEB_ENRICHMENT', 'true') === 'true';
  /** Campos del catálogo cuyos valores se describen con la web (sin distinguir tildes/mayúsculas). */
  readonly enrichFields = optional('ENRICH_FIELDS', 'Familia,Tipo de tejido')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  /** Horas que dura una respuesta en caché. 0 desactiva la caché. */
  readonly answerCacheTtlHours = Number(optional('ANSWER_CACHE_TTL_HOURS', '168'));

  /**
   * Similitud mínima (coseno, 0–1) para reutilizar la respuesta de una pregunta
   * parecida. 1 desactiva la caché por significado.
   */
  readonly semanticCacheMinSimilarity = Number(optional('SEMANTIC_CACHE_MIN_SIMILARITY', '0.92'));

  /** Precalentar la caché automáticamente cuando cambian los documentos del proyecto. */
  readonly cacheWarmAuto = optional('CACHE_WARM_AUTO', 'true') === 'true';

  /**
   * Secreto para firmar los tokens temporales del widget. Si no se define, se
   * deriva de la clave service_role (cambiarla invalida los tokens emitidos).
   */
  readonly widgetTokenSecret = (process.env.WIDGET_TOKEN_SECRET ?? '').trim();

  /** Precios en USD por millón de tokens, para estimar el gasto en el panel de uso. */
  readonly prices = {
    gemini: {
      input: Number(optional('GEMINI_PRICE_INPUT_PER_M', '1.50')),
      output: Number(optional('GEMINI_PRICE_OUTPUT_PER_M', '9.00')),
    },
    groq: {
      input: Number(optional('GROQ_PRICE_INPUT_PER_M', '0.15')),
      output: Number(optional('GROQ_PRICE_OUTPUT_PER_M', '0.60')),
    },
    /** Por defecto, gpt-5.4-mini. */
    openai: {
      input: Number(optional('OPENAI_PRICE_INPUT_PER_M', '0.75')),
      output: Number(optional('OPENAI_PRICE_OUTPUT_PER_M', '4.50')),
    },
    /** Por defecto, Mistral Medium. */
    mistral: {
      input: Number(optional('MISTRAL_PRICE_INPUT_PER_M', '1.50')),
      output: Number(optional('MISTRAL_PRICE_OUTPUT_PER_M', '7.50')),
    },
  };
}
