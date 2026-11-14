-- Avance del procesamiento de cada documento (lo muestra la lista de documentos).
alter table public.documents
  add column progress_stage text check (progress_stage in ('queued', 'reading', 'ocr', 'catalog', 'embedding', 'done')),
  add column progress_done  integer not null default 0,
  add column progress_total integer not null default 0,
  add column processing_started_at timestamptz;
