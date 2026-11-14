# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con [SemVer](https://semver.org/lang/es/).

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
