# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con [SemVer](https://semver.org/lang/es/).

## [0.21.0] - 2026-11-15

### Cambiado

- Las claves de Gemini, OpenAI y Groq se configuran en cada asistente (Asistente y widget → Modelos) y se guardan cifradas en Supabase Vault (`chatbot_secrets`). La plataforma ya no aporta claves: se eliminaron `GEMINI_API_KEY`, `GROQ_KEY` y `OPENAI_API_KEY` del código.
- Sin la clave del proveedor principal el asistente no responde y lo indica; el respaldo, el OCR de escaneados, las descripciones web y los embeddings por API usan solo las claves del asistente.
- El respaldo viene desactivado por defecto.
- La clave de Gemini que la empresa tenía guardada se copió a cada uno de sus asistentes; se eliminaron las claves por empresa y la página «Configuración de la empresa».

## [0.20.0] - 2026-11-15

### Agregado

- Pestaña «Modelos» en Asistente y widget: proveedor de lenguaje (Gemini, Groq u OpenAI) y modelo (sugerido o escrito a mano), modelo de respaldo (o ninguno), modelo de embeddings (E5 local, Gemini Embedding, OpenAI text-embedding-3-small/large) y prueba de conexión de cada uno.
- Claves de OpenAI y Groq por empresa en Supabase Vault (como la de Gemini), validadas antes de guardarse.
- OpenAI como proveedor de lenguaje (API compatible, con herramientas del catálogo y streaming) y precios configurables para el panel de gastos.

### Cambiado

- Los embeddings guardan su modelo y aceptan cualquier dimensión; la búsqueda y la caché por significado solo comparan vectores del mismo modelo. Cambiar el modelo de embeddings de un proyecto lo reindexa en segundo plano.
- La caché de respuestas se separa por proveedor y modelo de lenguaje; el panel de uso cuenta las respuestas del respaldo sea cual sea el proveedor.
- Eliminada `set_embedding_dimensions` (ya no hace falta cambiar la dimensión de las columnas).

## [0.19.0] - 2026-11-14

### Agregado

- Página pública de documentación `/docs/widget`: guía paso a paso para poner el asistente en el sitio de la empresa, con ilustraciones de las pantallas y del flujo, explorador de los campos de configuración, selector de modo (público o protegido) con diagrama, generador de código para HTML, WordPress, Shopify, Google Tag Manager y React/Next.js, ejemplos de `/chat-token` en C#, Java, Node, PHP y cURL, simulador del widget (nombre, color, bienvenida, preguntas sugeridas, posición), prueba con el asistente real, lista de verificación, buscador de problemas frecuentes y referencia de atributos.
- Enlaces «Guía de instalación» en Asistente y widget (con la clave ya cargada) y en la página de inicio.

## [0.18.0] - 2026-11-14

### Agregado

- Reordenador (cross-encoder multilingüe local, `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1`, Apache 2.0) entre la búsqueda y el modelo: de los 30 candidatos se eligen los 10 fragmentos más relevantes leyendo pregunta y fragmento juntos. Con tiempo máximo y vuelta al orden de la búsqueda si falla. Variables `RERANKER_*`.
- Modelo de embeddings configurable (`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_DTYPE`) y reindexado por proyecto: automático cuando el proyecto está indexado con otro modelo, o a mano con «Reindexar». Recalcula los embeddings del texto ya guardado, por lotes reanudables, con avance en la lista de documentos.
- Función `set_embedding_dimensions(n)` (solo service_role) para pasar a e5-base (768) o e5-large (1024).

### Cambiado

- Las funciones de búsqueda y de caché por significado aceptan vectores de cualquier dimensión; los fragmentos sin embedding (en reindexado) siguen apareciendo por la búsqueda por texto.

## [0.17.0] - 2026-11-14

### Cambiado

- Las claves secretas de API tienen su propia pestaña, «Claves de API», en «Asistente y widget» (owner/admin): tabla de claves con estado, creación, revocación, ejemplos para el servidor (cURL, C#, Java, Node) y token de prueba. La configuración del widget enlaza a esa pestaña cuando se elige el modo protegido.

## [0.16.0] - 2026-11-14

### Cambiado

- Nuevo diseño de la app: barra lateral oscura con las secciones del proyecto (Chat y documentos, Asistente y widget, Uso y gastos, Calidad) y el historial de conversaciones; en el móvil, menú desplegable.
- Superficies blancas sobre gris claro, un solo acento índigo, tipografía Geist (incluida en la app, sin depender de Google Fonts) e iconos de trazo en lugar de emojis.
- Ingreso e inicio con panel que explica el producto; proyectos en tarjetas con la creación integrada; chat con burbujas, consultas al catálogo en formato de código y fuentes desplegables; zona para subir documentos con estados en etiquetas.
- Widget: cabecera con subtítulo, burbujas con borde, campo y botón de envío con icono y botón flotante cuadrado redondeado.

## [0.15.0] - 2026-11-14

### Agregado

- Pestaña «Uso y gastos» en «Asistente y widget» (owner/admin): mensajes del widget hoy frente al tope diario, preguntas por día y origen, porcentaje desde la caché, gasto y ahorro estimados, desglose por canal y precalentamiento de la caché. Enlace directo «Uso y gastos» en la cabecera del proyecto.

### Cambiado

- El panel de uso sale de la página Calidad (que conserva valoraciones, preguntas del sitio y pruebas) y queda junto a la configuración del proyecto y el widget.

## [0.14.1] - 2026-11-14

### Corregido

- Caché: la misma pregunta quedaba guardada varias veces con respuestas distintas (versiones anteriores del contenido, clave antigua, chat interno y widget por separado). Ahora, al guardar, se borran las entradas de versiones anteriores del proyecto, y si la pregunta ya la respondió Gemini en el otro canal se reutiliza esa respuesta en vez de generar otra o usar Groq.
- No se guardan en caché las respuestas que dicen que no hay información («no aparece», «no se encontró»): solían venir de búsquedas incompletas o del modelo de respaldo sin herramientas y fijaban un «no» incorrecto.

## [0.14.0] - 2026-11-14

### Agregado

- Claves secretas de API por proyecto (`sk_live_…`): las genera la API, se muestran una sola vez y solo se guarda su hash. Se pueden nombrar y revocar, y registran su último uso.
- Widget **protegido con token**: además de la clave pública, cada visitante necesita un token temporal (1 h por defecto, máx. 24 h) que emite el servidor de la empresa con su clave secreta (`POST /v1/widget-tokens`). `widget.js` acepta `data-token`, `data-token-url` (lo renueva solo al vencer) o `window.RagWidget.setToken()`.
- API para el servidor de la empresa: `POST /v1/chat` (respuesta JSON o NDJSON en streaming), con el mismo límite diario del asistente; su uso aparece en el panel como «api».
- En «Asistente y widget»: selector de acceso (protegido/público), administración de claves, ejemplos en cURL, C#, Java y Node, y token de prueba para la página de prueba (que ahora acepta `?token=`).

## [0.13.1] - 2026-11-14

### Corregido

- Página de prueba del widget: el campo de la clave mostraba un error de formato genérico (por ejemplo, al escribir el nombre del asistente). Ahora acepta la clave o el código `<script>` completo y explica qué falta.

## [0.13.0] - 2026-11-14

### Agregado

- Página de prueba del widget (`apps/widget-demo`), publicada como proyecto aparte en Vercel: simula el sitio de una empresa en otro dominio y revisa paso a paso el script, la configuración, el botón y el chat dentro del iframe.
- El chat del widget avisa al sitio que lo inserta cuando está listo (`rag-widget-ready`).

### Corregido

- La API rechazaba por CORS la configuración pública del widget pedida desde el sitio de la empresa, así que el botón nunca aparecía fuera de la app. Ahora `/widget/:clave/config` acepta cualquier dominio (solo GET); el resto de la API sigue limitado a la app web.

## [0.12.0] - 2026-11-14

### Agregado

- Avance de la subida de cada archivo (MB subidos y porcentaje), con varios archivos en cola.
- Avance del procesamiento: etapa (en cola, lectura, OCR, catálogo, índice de búsqueda), fragmentos procesados de un total, porcentaje y tiempo restante estimado.

## [0.11.0] - 2026-11-14

### Agregado

- Caché por significado: una pregunta parecida reutiliza la respuesta guardada si menciona las mismas cifras y términos del catálogo. El chat indica qué pregunta se reutilizó.
- Precalentamiento de la caché (botón y automático al cambiar los documentos) con las preguntas sugeridas y las más frecuentes del widget y del equipo.
- Panel «Uso y caché»: preguntas por día y origen, porcentaje desde la caché, uso del respaldo, tokens, gasto y ahorro estimados.
- Registro de tokens de Gemini y Groq (chat, widget, pruebas, OCR y descripciones web).

## [0.10.1] - 2026-11-14

### Corregido

- Gemini a veces terminaba sin texto después de consultar el catálogo (la respuesta quedaba vacía, no se cacheaba y cada repetición volvía a consultar). En la última ronda se mantienen las herramientas declaradas pero se prohíbe usarlas y se pide la respuesta explícitamente; si aun así no hay texto, se insiste una vez y luego responde el respaldo (o la respuesta guardada).
- La caché ya no se invalida al cambiar el nombre, el idioma o las instrucciones del asistente: una respuesta de Gemini guardada se devuelve en cualquier conversación del proyecto. Solo se separan el chat interno y el widget público.

## [0.10.0] - 2026-11-14

### Agregado

- 👍/👎 con comentario opcional en las respuestas del chat de la app y del widget.
- Registro de las preguntas de los visitantes del widget (`widget_messages`), con su valoración, visible para owner/admin/editor.
- Página **Calidad** por proyecto: valoraciones del equipo, preguntas del sitio web y pruebas automáticas.
- Pruebas automáticas de calidad: preguntas con textos esperados y prohibidos; se ejecutan en la cola, sin caché, y muestran qué faltó en cada respuesta.
- OCR con Gemini para PDF escaneados e imágenes (PNG, JPG, WebP), con la transcripción guardada para no repetir el costo.
- Soporte para Excel (`.xlsx`): cada hoja se procesa como un CSV (fragmentos por fila, catálogo y descripciones web).

### Corregido

- El tipo de archivo se detecta por la extensión: Windows reporta los CSV como `application/vnd.ms-excel` y se rechazaban.

## [0.9.0] - 2026-11-14

### Cambiado

- Las respuestas de Groq en caché son provisionales: al repetirse la pregunta se intenta con Gemini. Si responde, su respuesta reemplaza a la de Groq; si falla, se entrega la de Groq guardada sin llamar de nuevo a Groq. Las respuestas de Gemini en caché se usan directamente. No hay invalidación por tiempo extra.

## [0.8.0] - 2026-11-14

### Cambiado

- La caché de respuestas guarda también las respuestas del modelo de respaldo (Groq), con la indicación del modelo que las generó.

## [0.7.1] - 2026-11-14

### Corregido

- CORS: se permite el método `PUT`, necesario para guardar la clave de Gemini de la empresa y la configuración del asistente.

## [0.7.0] - 2026-11-14

### Agregado

- Asistente personalizable por proyecto: nombre, color, logo, bienvenida, preguntas sugeridas, idioma e instrucciones de tono. Se aplica al chat de la app y al widget.
- Widget para el sitio web de la empresa (`widget.js` + `/embed/<clave>`), con dominios autorizados (CSP `frame-ancestors`), límite por visitante, tope diario de mensajes y opción de ocultar fuentes.
- Clave de Gemini propia por empresa, verificada antes de guardarse y cifrada en Supabase Vault; nunca se devuelve al navegador.

### Cambiado

- La lógica de respuesta del chat pasa a `ChatEngineService`, compartido entre la app y el widget.
- La caché separa las respuestas por personalización del asistente.

## [0.6.0] - 2026-11-14

### Agregado

- Modelo de respaldo en Groq (`openai/gpt-oss-120b` por defecto): si Gemini falla o no responde en 25 s, la pregunta se responde con Groq usando el mismo contexto y las herramientas del catálogo.
- El chat muestra qué modelo respondió cada mensaje y, cuando hay cambio, el aviso con el motivo.

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
