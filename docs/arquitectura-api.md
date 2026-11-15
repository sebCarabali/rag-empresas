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
                │ documentos, proyectos, acceso, ingesta,      │ ───▶ (sin dependencias)
                │ reindexado, pruebas, precalentado, claves    │      errores, asistente,
                │ ports/: interfaces + tokens de inyección     │      llm, catálogo de
                └───────────────┬──────────────────────────────┘      modelos, prompt, caché,
                                ▼ implementan                         ingesta, evaluación
                ┌──────────────── infrastructure ──────────────┐
                │ llm/ Gemini, OpenAI-compatible (+ dialectos)  │
                │ embeddings/ E5 local, Gemini, OpenAI/Mistral  │
                │ persistence/ repositorios sobre Supabase      │
                │ storage/ archivos · secrets/ Vault            │
                │ supabase/ clientes y sesión                   │
                │ ocr/ · extraction/ · rerank/ · queue/         │
                └──────────────────────────────────────────────┘
  composition/: CoreModule y ApplicationModule (enlazan puertos → adaptadores)
  config/: configuración tipada (variables de entorno), transversal
```

## Capas

| Capa | Carpeta | Contiene | Depende de |
|---|---|---|---|
| Dominio | `domain/` | Tipos y reglas puras: errores de la aplicación (`errors.ts`), asistente (`chatbots/chatbot.ts`), eventos y errores de LLM (`llm/llm.ts`), catálogo de proveedores y modelos, prompt y diversificación, normalización de preguntas y control léxico de la caché, chunker, catálogo CSV, evaluación | nada |
| Aplicación | `application/` | Casos de uso y `ports/` | dominio y puertos |
| Infraestructura | `infrastructure/` | Adaptadores de los puertos | aplicación (puertos), dominio, SDKs |
| Interfaces | `interfaces/http/` | Controladores REST/NDJSON, guard de autenticación, filtro que traduce los errores de la aplicación a HTTP | aplicación |
| Composición | `composition/` | Módulos de Nest que enlazan puertos y adaptadores | todo |

## Regla de dependencias

Ningún archivo de `application/` ni de `interfaces/` importa de `infrastructure/`:
solo los adaptadores usan `SupabaseService`. Se comprueba con

```bash
grep -rln "infrastructure/" apps/api/src/application apps/api/src/interfaces --include=*.ts | grep -v spec
```

que no debe devolver nada.

## Ámbito de datos y errores

- **`DataScope`** (`application/ports/data-scope.ts`) dice con qué permisos se
  accede: `userScope(token)` en la app (las políticas RLS de la base aíslan a
  cada empresa y aplican el rol) o `SYSTEM_SCOPE` en el worker, el widget y la
  API pública, que validan el acceso por otra vía. Los controladores lo obtienen
  con `scopeOf(user)`; los adaptadores lo resuelven a un cliente de Supabase
  (`SupabaseService.client(scope)`).
- **Errores** (`domain/errors.ts`): `NotFoundError`, `ForbiddenError`,
  `ConflictError`, `InvalidInputError`. Los adaptadores traducen los de
  PostgREST (`persistence/supabase-result.ts`) y `DomainErrorFilter` los
  convierte en 404, 403, 409 y 400 (401 para `InvalidApiKeyError`).
- **`ProjectAccessService`** centraliza «el usuario ve el proyecto y tiene uno
  de estos roles» (antes repetido en cada controlador).

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
| `ProjectRepository` | Proyectos y estado del reindexado | `SupabaseProjectRepository` |
| `AccessPolicy` / `CompanyRepository` | Rol del usuario en la empresa / empresas y membresías | `SupabaseAccessPolicy`, `SupabaseCompanyRepository` |
| `DocumentRepository` / `ChunkRepository` / `CatalogRepository` | Documentos, fragmentos indexados y catálogo estructurado | `SupabaseDocumentRepository`, `SupabaseChunkRepository`, `SupabaseCatalogRepository` |
| `FileStorage` | Archivos de los documentos (y URL de subida firmada) | `SupabaseFileStorage` |
| `ChatbotRepository` | Asistente del proyecto, clave pública, mensajes del día | `SupabaseChatbotRepository` |
| `ConversationRepository` / `FeedbackRepository` | Chat de la app y sus valoraciones | `SupabaseConversationRepository`, `SupabaseFeedbackRepository` |
| `WidgetMessageRepository` / `QuestionHistory` | Preguntas de los visitantes / preguntas recientes para precalentar | `SupabaseWidgetMessageRepository`, `SupabaseQuestionHistory` |
| `EvalRepository` | Pruebas de calidad (preguntas, ejecuciones y resultados) | `SupabaseEvalRepository` |
| `EnrichmentRepository` | Descripciones web del catálogo | `SupabaseEnrichmentRepository` |
| `WarmRunRepository` | Ejecuciones del precalentamiento | `SupabaseWarmRunRepository` |
| `ApiKeyRepository` | Claves secretas de API (solo el hash) | `SupabaseApiKeyRepository` |
| `ProviderKeyWriter` | Guardar o borrar claves del asistente | `VaultProviderKeyStore` |
| `UsageStats` | Resumen diario del uso | `SupabaseUsageStats` |
| `AccessTokenVerifier` | Verificar el token de sesión | `SupabaseTokenVerifier` |

## Patrones de diseño

| Patrón | Dónde | Por qué |
|---|---|---|
| Strategy | `ChatModel`, `EmbeddingBackend`, `OpenAiDialect` | Cada proveedor es intercambiable; el caso de uso elige por configuración |
| Registry | `ChatModelRegistry` | Resuelve el adaptador de un proveedor sin conocer clases concretas |
| Decorator | `FirstEventTimeoutChatModel` | Agrega el tiempo límite del primer evento a cualquier modelo sin modificarlo |
| Chain of Responsibility | `CacheLookupChain` (exacta → por significado → otro canal) | Cada eslabón decide si busca o deja pasar; se agregan pasos sin tocar el caso de uso |
| Abstract Factory | `KnowledgeBaseFactory` | Crea la base de conocimiento para un ámbito de datos (permisos del usuario o del sistema) |
| Repository | todos los `*Repository`, `AnswerCache` | Aísla la persistencia: los casos de uso y controladores no saben que hay Supabase |
| Adapter | todos los de `infrastructure/` | Traducen SDKs y APIs externas a los puertos |
| Facade | `ChatEngineService` | Un solo punto para «responder una pregunta» (lo usan app, widget, API, pruebas y precalentado) |
| Exception translation | `supabase-result.ts` + `DomainErrorFilter` | La base traduce a errores de la aplicación; HTTP traduce a códigos de estado |
| Dependency Injection / Composition Root | `composition/` | Enlaza puertos con adaptadores en un único lugar |

## SOLID

- **S**: cada clase tiene una responsabilidad (p. ej. el orquestador de LLM ya no habla HTTP; el tiempo límite es un decorador; la cadena de caché está separada del caso de uso).
- **O**: agregar un proveedor compatible con OpenAI es agregar un dialecto (así entró Mistral); agregar otro tipo es un adaptador registrado en `composition/`. Los casos de uso no cambian.
- **L**: todos los `ChatModel` y `EmbeddingBackend` son intercambiables (las pruebas usan dobles que cumplen el mismo contrato).
- **I**: puertos pequeños y específicos (`ProviderKeyReader` separado de `ProviderKeyWriter` y `ProviderKeyValidator`, `DocumentReader` de `TextRecognizer`, un repositorio por agregado).
- **D**: la aplicación y los controladores dependen de interfaces inyectadas por token (`@Inject(CHAT_MODELS)`, `@Inject(DOCUMENT_REPOSITORY)`…), no de Supabase ni de los SDK. Las pruebas usan repositorios en memoria.

## Cómo agregar un proveedor de lenguaje

1. Si su API es compatible con OpenAI: agregar un `OpenAiDialect` en `infrastructure/llm/openai-dialects.ts` y registrarlo en `CHAT_MODELS` (`composition/application.module.ts`).
2. Si no: crear un adaptador que implemente `ChatModel` y registrarlo.
3. Agregarlo al catálogo (`domain/models/catalog.ts`: `LlmProvider`, etiqueta y sugerencias), a la configuración (modelo y precios por defecto) y a la migración (restricciones y columnas de `chatbot_secrets`).

## Cómo cambiar de base de datos

Implementar los puertos `*Repository`, `AccessPolicy`, `FileStorage`,
`UsageStats`, `ProviderKeyReader`/`Writer`, `AccessTokenVerifier`, `AnswerCache`
y `KnowledgeBaseFactory`, y cambiar las tablas `PERSISTENCE` de
`composition/core.module.ts` y los adaptadores de `composition/application.module.ts`.
Los casos de uso, los controladores y las pruebas no cambian.
