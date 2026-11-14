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
| `rag-empresas-api` | `apps/api` | Other (lo fija `vercel.json`) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `WEB_ORIGIN` |

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
- El chat responde bien preguntas puntuales sobre un catálogo, pero no conteos ni listados completos, porque solo lee los fragmentos más relevantes.
- Si cambias el modelo de embeddings por uno con otra dimensión, hay que ajustar `vector(384)` en la migración y reprocesar todos los documentos.
