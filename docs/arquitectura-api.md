# Arquitectura de la API (hexagonal)

La API (`apps/api/src`) sigue la arquitectura hexagonal (puertos y adaptadores):
el dominio y los casos de uso no conocen NestJS HTTP, Supabase ni las APIs de
los modelos; hablan con el exterior por **puertos** (interfaces) que
implementan **adaptadores**. La raíz de composición (Nest) enlaza cada puerto
con su adaptador.

```
                ┌──────────────────────── interfaces/http ───────────────────────┐
  navegador ──▶ │ controladores (chat, widget, API pública, modelos, documentos…) │
                └───────────────┬────────────────────────────────────────────────┘
                                ▼
                ┌──────────────── application ────────────────┐
                │ casos de uso: ChatEngine, LlmService,        │
                │ EmbeddingsService, ModelSettingsService,     │      domain
                │ ingesta, reindexado, pruebas, precalentado   │ ───▶ (sin dependencias)
                │ ports/: interfaces + tokens de inyección     │      llm, catálogo de
                └───────────────┬──────────────────────────────┘      modelos, prompt, caché,
                                ▼ implementan                         ingesta, evaluación
                ┌──────────────── infrastructure ──────────────┐
                │ llm/ Gemini, OpenAI-compatible (+ dialectos)  │
                │ embeddings/ E5 local, Gemini, OpenAI/Mistral  │
                │ persistence/ Supabase (caché, conocimiento,   │
                │   configuración, uso) · secrets/ Vault        │
                │ ocr/ · extraction/ · rerank/ · queue/         │
                └──────────────────────────────────────────────┘
  composition/: CoreModule y ApplicationModule (enlazan puertos → adaptadores)
  config/: configuración tipada (variables de entorno), transversal
```

## Capas

| Capa | Carpeta | Contiene | Depende de |
|---|---|---|---|
| Dominio | `domain/` | Tipos y reglas puras: eventos y errores de LLM (`llm/llm.ts`), catálogo de proveedores y modelos, prompt y diversificación, normalización de preguntas y control léxico de la caché, chunker, catálogo CSV, evaluación | nada |
| Aplicación | `application/` | Casos de uso y `ports/` | dominio y puertos |
| Infraestructura | `infrastructure/` | Adaptadores de los puertos | aplicación (puertos), dominio, SDKs |
| Interfaces | `interfaces/http/` | Controladores REST/NDJSON, guard de autenticación | aplicación |
| Composición | `composition/` | Módulos de Nest que enlazan puertos y adaptadores | todo |

## Puertos

| Puerto (token) | Para qué | Adaptador |
|---|---|---|
| `ChatModel` (`CHAT_MODELS`) | Conversar con un proveedor de lenguaje (streaming y herramientas) | `GeminiChatModel`, `OpenAiCompatibleChatModel` (Groq, OpenAI, Mistral) |
| `EmbeddingBackend` (`EMBEDDING_BACKENDS`) | Calcular embeddings | `LocalE5EmbeddingBackend`, `GeminiEmbeddingBackend`, `OpenAiCompatibleEmbeddingBackend` (OpenAI, Mistral) |
| `ProviderKeyReader` / `ProviderKeyValidator` | Leer las claves del asistente / validarlas | `VaultProviderKeyStore`, `HttpProviderKeyValidator` |
| `ModelSettingsRepository` | Configuración de modelos y estado de las claves | `SupabaseModelSettingsRepository` |
| `AnswerCache` | Respuestas guardadas (exactas y por significado) | `SupabaseAnswerCache` |
| `KnowledgeBaseFactory` → `KnowledgeBase` | Búsqueda híbrida, versión del contenido, vocabulario, descripciones web, herramientas del catálogo (por ámbito de datos: RLS del usuario o service_role) | `SupabaseKnowledgeBaseFactory` |
| `Reranker` | Reordenar candidatos | `TransformersReranker` |
| `UsageRecorder` | Registro de uso y gasto | `SupabaseUsageRecorder` |
| `DocumentReader` / `TextRecognizer` | Leer archivos / OCR | `FileDocumentReader`, `GeminiOcrService` |
| `WebResearcher` | Descripciones web del catálogo | `GeminiWebResearcher` |
| `JobQueue` | Trabajos en segundo plano | `IngestionQueueService` (Vercel Queues) |

## Patrones de diseño

| Patrón | Dónde | Por qué |
|---|---|---|
| Strategy | `ChatModel`, `EmbeddingBackend`, `OpenAiDialect` | Cada proveedor es intercambiable; el caso de uso elige por configuración |
| Registry | `ChatModelRegistry` | Resuelve el adaptador de un proveedor sin conocer clases concretas |
| Decorator | `FirstEventTimeoutChatModel` | Agrega el tiempo límite del primer evento a cualquier modelo sin modificarlo |
| Chain of Responsibility | `CacheLookupChain` (exacta → por significado → otro canal) | Cada eslabón decide si busca o deja pasar; se agregan pasos sin tocar el caso de uso |
| Abstract Factory | `KnowledgeBaseFactory` | Crea la base de conocimiento para un ámbito de datos (permisos del usuario o servicio) |
| Repository | `ModelSettingsRepository`, `AnswerCache` | Aísla la persistencia |
| Adapter | todos los de `infrastructure/` | Traducen SDKs y APIs externas a los puertos |
| Facade | `ChatEngineService` | Un solo punto para «responder una pregunta» (lo usan app, widget, API, pruebas y precalentado) |
| Dependency Injection / Composition Root | `composition/` | Enlaza puertos con adaptadores en un único lugar |

## SOLID

- **S**: cada clase tiene una responsabilidad (p. ej. el orquestador de LLM ya no habla HTTP; el tiempo límite es un decorador; la cadena de caché está separada del caso de uso).
- **O**: agregar un proveedor compatible con OpenAI es agregar un dialecto (así entró Mistral); agregar otro tipo es un adaptador registrado en `composition/`. Los casos de uso no cambian.
- **L**: todos los `ChatModel` y `EmbeddingBackend` son intercambiables (las pruebas usan dobles que cumplen el mismo contrato).
- **I**: puertos pequeños y específicos (`ProviderKeyReader` separado de `ProviderKeyValidator`, `DocumentReader` de `TextRecognizer`).
- **D**: la aplicación depende de interfaces inyectadas por token (`@Inject(CHAT_MODELS)`, `@Inject(ANSWER_CACHE)`…), no de Supabase ni de los SDK.

## Cómo agregar un proveedor de lenguaje

1. Si su API es compatible con OpenAI: agregar un `OpenAiDialect` en `infrastructure/llm/openai-dialects.ts` y registrarlo en `CHAT_MODELS` (`composition/application.module.ts`).
2. Si no: crear un adaptador que implemente `ChatModel` y registrarlo.
3. Agregarlo al catálogo (`domain/models/catalog.ts`: `LlmProvider`, etiqueta y sugerencias), a la configuración (modelo y precios por defecto) y a la migración (restricciones y columnas de `chatbot_secrets`).

## Pendiente

Los servicios por lotes que hacen mucho trabajo de datos (ingesta, descripciones web, pruebas de calidad, precalentamiento, reindexado, claves de API) y la mayoría de los controladores todavía usan `SupabaseService` directamente. El siguiente paso es extraer sus repositorios (documentos, fragmentos, catálogo, pruebas, claves de API) como se hizo con la caché y la configuración de modelos.
