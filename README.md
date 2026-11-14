# rag-empresas

Plataforma RAG multi-empresa: cada empresa se registra con su email, crea proyectos, sube documentos y los consulta por chat. Cada respuesta cita el documento y la página de donde sale.

## Arquitectura

```
Navegador ──► apps/web (Next.js, Vercel)
   │              │  login con enlace mágico (Supabase Auth)
   │              ▼
   │         apps/api (NestJS, Vercel) ──────► Gemini (respuesta en streaming)
   │           ├─ api/index.js         HTTP: empresas, proyectos, documentos, chat
   │           └─ api/queues/ingest.js worker privado (Vercel Queues)
   │                    │  extrae texto → chunks → embeddings (multilingual-e5-small, local)
   ▼                    ▼
Supabase Storage    Supabase Postgres + pgvector (RLS por empresa)
```

| Pieza | Tecnología |
|---|---|
| Frontend | Next.js 16 (App Router) + Tailwind |
| API y worker | NestJS 11 sobre Vercel Functions (Fluid compute) |
| Cola | Vercel Queues (topic `document-ingestion`) |
| Auth, base de datos y archivos | Supabase (Auth, Postgres + pgvector, Storage) |
| LLM | Gemini (`GEMINI_MODEL`, por defecto `gemini-3.5-flash`) |
| Embeddings | `Xenova/multilingual-e5-small` cuantizado, 384 dimensiones, gratis y en la misma función |
| Búsqueda | Híbrida: vectorial + texto completo en español, combinadas con RRF |

### Seguridad multi-empresa

- La API usa **el JWT del usuario** contra Supabase, así que todas las consultas pasan por **RLS**. Un usuario solo ve los datos de las empresas donde es miembro.
- Roles: `owner`, `admin` (gestionan proyectos), `editor` (sube y borra documentos), `viewer` (solo consulta).
- Solo el worker usa la `service_role` key.
- El prompt trata los fragmentos como datos, no como instrucciones, para mitigar *prompt injection* desde documentos subidos.

### Asistente personalizable y widget

Cada proyecto tiene su asistente (`chatbots`), configurable en **Proyecto → Asistente y widget** (owner/admin):

- **Personalización** (app y widget): nombre, color, logo, mensaje de bienvenida, preguntas sugeridas, idioma e instrucciones de tono y estilo. Las instrucciones se agregan al prompt dentro de `<instrucciones_empresa>` y no pueden anular las reglas de base (usar solo el contexto, no inventar, citar).
- **Widget para el sitio web:** la empresa pega una línea antes de `</body>`:

  ```html
  <script src="https://rag-empresas-web.vercel.app/widget.js" data-bot="bot_xxx" async></script>
  ```

  Muestra un botón flotante (`data-position="left"` para ponerlo a la izquierda) que abre el chat en un iframe (`/embed/<clave>`).
- **Seguridad del widget:**
  - El iframe solo se puede insertar en los **dominios autorizados** (`Content-Security-Policy: frame-ancestors`, en `proxy.ts`).
  - La API pública (`/widget/:clave/...`) solo accede al proyecto de ese chatbot, limita 10 mensajes por minuto por visitante y aplica un **tope diario** configurable (`widget_usage`).
  - No envía fuentes ni detalles del modelo al navegador salvo que se active «Mostrar fuentes».
  - El historial vive solo en el navegador del visitante.
  - El widget es público: actívalo solo en proyectos con información para clientes.
- La clave pública se puede regenerar; la anterior deja de funcionar.

### Clave de Gemini por empresa

En **Configuración de la empresa** (owner/admin) cada empresa puede cargar su propia clave de Gemini. Así el chat y las descripciones web de sus proyectos usan su cuenta y su cuota.

- La API comprueba la clave contra Gemini antes de guardarla.
- Se guarda **cifrada en Supabase Vault** mediante `set_company_gemini_key`. `company_secrets` solo guarda la referencia y los últimos 4 caracteres.
- Solo `service_role` puede descifrarla (`get_company_gemini_key`): nunca llega al navegador.
- Sin clave propia se usa `GEMINI_API_KEY` de la plataforma. El respaldo en Groq es siempre el de la plataforma.

### Descripciones web de las telas

Al terminar de procesar un CSV, el worker encola un trabajo `enrich` en la misma cola. Para cada valor distinto de los campos de `ENRICH_FIELDS` (por defecto `Familia` y `Tipo de tejido`), le pide a Gemini, **con Google Search**, una descripción general: qué es, características, usos y cuidados. Le pasa como contexto las composiciones y los tipos de tejido más frecuentes de esa familia en el catálogo. El resultado se guarda en `catalog_enrichments` con sus fuentes web.

- Se genera **una sola vez** por valor y proyecto: con el catálogo actual son unas 16 búsquedas, no una por pregunta.
- En el chat, si la pregunta menciona una familia o los productos recuperados pertenecen a ella, se agrega su descripción al contexto marcada como «descripción general (web)», y en las fuentes aparece con sus enlaces. El prompt obliga a tomar los datos técnicos del catálogo, nunca de la web.
- En la vista del proyecto, el panel **Descripciones web** permite revisarlas, reintentar las fallidas o regenerarlas.
- La búsqueda con Google de Gemini **requiere una clave con facturación activa**. Sin facturación, las descripciones quedan con error y el resto funciona igual. `WEB_ENRICHMENT=false` la desactiva.

### Chat

1. **Caché:** toda pregunta que se entienda por sí sola se busca en `answer_cache`, también a mitad de una conversación. Se saltan las preguntas de seguimiento («¿y en plano?», «¿cuál de esas…?», «dame más»), porque su significado depende de lo anterior. La clave combina el proyecto, la pregunta normalizada (sin tildes ni signos), el modelo y una versión del contenido (cantidad de documentos y su última modificación), así que subir, reprocesar o borrar un documento la invalida sola. Dura `ANSWER_CACHE_TTL_HOURS` (168 h por defecto; 0 la desactiva).
2. **Búsqueda híbrida:** pide 30 candidatos y se queda con 10, con un máximo de 2 por producto, para que una tela con muchas variantes no acapare el contexto.
3. **Gemini:** responde en streaming y puede llamar a las herramientas del catálogo (hasta 4 rondas). Las consultas que hace se muestran en el chat y se guardan en `messages.tool_calls`.
4. **Respaldo en Groq:** si Gemini falla (cuota, servicio caído, clave inválida) o no empieza a responder en `GEMINI_FIRST_EVENT_TIMEOUT_MS` (25 s), la misma pregunta se responde con Groq (`GROQ_MODEL`, por defecto `openai/gpt-oss-120b`), con el mismo contexto y las mismas herramientas del catálogo. El chat muestra qué modelo respondió y por qué hubo cambio; queda guardado en `messages.model_info`. Las respuestas del respaldo también se cachean, con el modelo que las generó. Requiere `GROQ_KEY`.
5. El prompt prohíbe afirmar que algo «no existe» a partir de resultados parciales.

### Flujo de un documento

1. `POST /projects/:id/documents` registra el documento y devuelve una URL firmada.
2. El navegador sube el archivo **directo a Supabase Storage**, sin pasar por la función.
3. `POST /documents/:id/process` lo encola en Vercel Queues.
4. El worker extrae el texto, lo divide en fragmentos, genera los embeddings y los guarda. Si el documento es grande, lo procesa en lotes que encadena por la cola para no pasar de 300 s por invocación.

## Estructura

```
apps/
  api/                 NestJS (proyecto Vercel "api")
    api/index.js       función HTTP
    api/queues/        función consumidora de la cola
    src/               código Nest (se compila a dist/)
  web/                 Next.js (proyecto Vercel "web")
supabase/migrations/   esquema, RLS, storage y búsqueda híbrida
.github/workflows/     CI y migraciones
```

## Puesta en marcha

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Aplica las migraciones:
   ```bash
   npx supabase login
   npx supabase link --project-ref TU_PROJECT_REF
   npx supabase db push
   ```
3. En **Authentication → URL Configuration**:
   - *Site URL*: la URL de producción del frontend.
   - *Redirect URLs*: `http://localhost:3000/auth/callback` y `https://TU-WEB.vercel.app/auth/callback`. Agrega también el patrón de previews si lo usas, por ejemplo `https://*-TU-EQUIPO.vercel.app/auth/callback`.
4. Para producción, configura un SMTP propio en **Authentication → Emails**. El de Supabase tiene un límite muy bajo de correos por hora.

### 2. Desarrollo local

Requisitos: Node 22+ y pnpm 10.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # completa las claves
cp apps/web/.env.example apps/web/.env.local
pnpm dev:api    # http://localhost:3001
pnpm dev:web    # http://localhost:3000
```

En local `INGEST_INLINE=true`: los documentos se procesan en el mismo proceso de la API, sin Vercel Queues. La primera vez se descarga el modelo de embeddings (~120 MB) desde Hugging Face.

### 3. Vercel (dos proyectos del mismo repositorio)

| Proyecto | Root Directory | Framework | Variables |
|---|---|---|---|
| `rag-empresas-web` | `apps/web` | Next.js | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` |
| `rag-empresas-api` | `apps/api` | Other (lo fija `vercel.json`) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_KEY` (opcional), `WEB_ORIGIN` |

- `WEB_ORIGIN` lleva la URL del frontend (o varias separadas por coma) para CORS.
- Rama de producción: `main`. Los pushes a `develop` y a cada PR generan *previews*.
- Vercel Queues está en beta. El trigger del worker está declarado en `apps/api/vercel.json`.

### 4. GitHub

- Protege `main` y `develop` (PR obligatorio + check `CI`).
- Para que `.github/workflows/db-migrations.yml` aplique migraciones al integrar a `main`, crea el environment `production` con los secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` y `SUPABASE_PROJECT_ID`.

## Flujo de ramas

Gitflow: ver [CONTRIBUTING.md](./CONTRIBUTING.md).

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado (público) |
| GET | `/me` | Usuario y sus empresas con rol |
| POST | `/companies` | Registrar empresa (el creador queda como owner) |
| GET/POST | `/companies/:companyId/projects` | Listar / crear proyectos |
| GET/PATCH/DELETE | `/projects/:projectId` | Ver / editar / eliminar proyecto |
| GET/POST | `/projects/:projectId/documents` | Listar / registrar documento (devuelve URL de subida) |
| POST | `/documents/:documentId/process` | Encolar o reprocesar |
| DELETE | `/documents/:documentId` | Eliminar documento y su archivo |
| GET/POST | `/projects/:projectId/conversations` | Listar / crear conversaciones |
| GET | `/conversations/:id/messages` | Historial |
| POST | `/conversations/:id/messages` | Preguntar (respuesta NDJSON en streaming) |
| DELETE | `/conversations/:id` | Eliminar conversación |

## Límites conocidos

- Los PDF escaneados (imágenes) no tienen texto: necesitan OCR, que no está incluido.
- Formatos soportados: PDF, DOCX, TXT, Markdown y CSV.
- Los CSV se procesan por filas: un fragmento por producto con texto limpio («Columna: valor»). Las exportaciones de WooCommerce se reconocen solas (atributos en pares nombre/valor, aunque el encabezado no esté en la primera fila), las variantes con los mismos atributos se agrupan y las composiciones abreviadas se expanden (Pol → Poliéster, Alg → Algodón…).
- Además, cada producto de un CSV se guarda en la tabla `catalog_items`. El chat le da a Gemini dos herramientas (`contar_productos` y `buscar_productos`) que ejecutan la función `search_catalog` con filtros exactos (menor, mayor, igual, contiene…), conteos agrupados y orden. Así responde bien preguntas como «telas de menos de 120 g/m²», «¿cuántas hay por submarca?» o «la más pesada». La función usa el JWT del usuario (RLS) y arma el SQL con `format(%L)`, sin riesgo de inyección.
- Si cambias el modelo de embeddings por uno con otra dimensión, hay que ajustar `vector(384)` en la migración y reprocesar todos los documentos.
