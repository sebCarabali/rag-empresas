# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con [SemVer](https://semver.org/lang/es/).

## [0.5.0] - 2026-11-14

### Cambiado

- La caché de respuestas también funciona dentro de una misma conversación para las preguntas que se entienden solas. Las preguntas de seguimiento («¿y en plano?», «¿cuál de esas…?») siguen generándose siempre.

## [0.4.0] - 2026-11-14

### Agregado

- Descripciones web de cada familia y tipo de tela (Gemini con Google Search), generadas una vez al procesar un CSV y guardadas en `catalog_enrichments`. El chat las usa para explicar las telas, marcadas como información general y con sus enlaces.
- Panel «Descripciones web» en el proyecto para revisarlas y regenerarlas.
- La raíz de la API (`/`) responde con su estado.

## [0.3.0] - 2026-11-14

### Agregado

- Catálogo estructurado: los productos de cada CSV se guardan en `catalog_items` y el chat puede filtrarlos, contarlos y ordenarlos con exactitud (herramientas `contar_productos` y `buscar_productos` de Gemini). Responde bien filtros numéricos, conteos, listados y rankings.
- Caché de respuestas para la primera pregunta de cada conversación (`ANSWER_CACHE_TTL_HOURS`, 168 h por defecto). Se invalida al subir, reprocesar o borrar documentos.
- El chat muestra las consultas que hizo al catálogo y si la respuesta vino de la caché.

### Cambiado

- La búsqueda híbrida limita a 2 fragmentos por producto para que un solo producto no acapare los resultados.
- El asistente ya no afirma que algo «no existe» a partir de resultados parciales.

## [0.2.0] - 2026-11-14

### Agregado

- Procesamiento de CSV por filas: un fragmento por producto con texto limpio. Soporta exportaciones de WooCommerce (encabezado en cualquier fila, atributos en pares), agrupa variantes idénticas, expande abreviaturas de composición textil y normaliza medidas.
- El chat recupera 10 fragmentos por pregunta.

### Cambiado

- Versionado sin tags de git (ver CONTRIBUTING.md).

## [0.1.2] - 2026-11-14

### Corregido

- Al encolar un documento, la verificación en Storage usaba `exists()`, que devolvía falso aunque el archivo existiera. Ahora usa `list()` y registra el error real.
- La API valida al arrancar que `SUPABASE_SERVICE_ROLE_KEY` sea una clave secreta (y no la pública) y muestra un mensaje claro si no lo es.
- Los fallos al borrar archivos de Storage quedan registrados en los logs.

## [0.1.1] - 2026-11-14

### Seguridad

- Se retira EXECUTE de `anon` en las funciones SECURITY DEFINER (`is_company_member`, `has_company_role`) y de todos los roles en la función de trigger `add_company_owner` (aviso del linter de Supabase).

## [0.1.0] - 2026-11-14

### Agregado

- Esquema multi-empresa en Supabase con RLS por empresa y roles (owner, admin, editor, viewer).
- Búsqueda híbrida (pgvector + texto completo en español) con Reciprocal Rank Fusion.
- API NestJS en Vercel: empresas, proyectos, documentos y chat.
- Worker de ingesta con Vercel Queues: PDF, DOCX, TXT, MD y CSV; embeddings locales con multilingual-e5-small.
- Chat RAG con Gemini en streaming y fuentes citadas.
- Frontend Next.js: registro por email con enlace mágico, proyectos, subida de documentos y chat.
- CI en GitHub Actions y migraciones automáticas al integrar a `main`.
