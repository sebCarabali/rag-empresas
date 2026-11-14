'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ACCEPTED_FILES, api, type DocumentItem, type DocumentStatus } from '@/lib/api';
import { UploadIcon } from './icons';
import { Badge, ErrorText, SectionTitle, Spinner } from './ui';

const STATUS_LABEL: Record<DocumentStatus, { text: string; tone: 'neutral' | 'ok' | 'warn' | 'brand' | 'danger' }> = {
  uploading: { text: 'Subiendo', tone: 'neutral' },
  pending: { text: 'En cola', tone: 'warn' },
  processing: { text: 'Procesando', tone: 'brand' },
  ready: { text: 'Listo', tone: 'ok' },
  failed: { text: 'Error', tone: 'danger' },
};

const STAGE_LABEL: Record<NonNullable<DocumentItem['progress_stage']>, string> = {
  queued: 'Esperando turno en la cola',
  reading: 'Leyendo el archivo',
  ocr: 'Leyendo el texto con OCR (Gemini)',
  catalog: 'Guardando el catálogo de productos',
  embedding: 'Generando el índice de búsqueda',
  done: 'Listo',
};

interface Upload {
  name: string;
  loaded: number;
  total: number;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${Math.max(s, 1)} s`;
  return `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim();
}

function ProgressBar({ value, indeterminate }: { value: number; indeterminate?: boolean }) {
  return (
    <div
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eef0f3]"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}
    >
      <div
        className={`h-full rounded-full bg-brand transition-[width] duration-500 ${indeterminate ? 'w-1/3 animate-pulse' : ''}`}
        style={indeterminate ? undefined : { width: `${Math.max(2, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

/** Avance del procesamiento, con tiempo restante estimado a partir de la velocidad del servidor. */
function ProcessingProgress({ doc }: { doc: DocumentItem }) {
  const stage = doc.status === 'pending' ? 'queued' : (doc.progress_stage ?? 'reading');
  const done = doc.progress_done ?? 0;
  const total = doc.progress_total ?? 0;
  const counting = stage === 'embedding' && total > 0;
  let eta: string | null = null;
  if (counting && done > 0 && doc.processing_started_at && doc.updated_at) {
    const elapsed = Date.parse(doc.updated_at) - Date.parse(doc.processing_started_at);
    if (elapsed > 0) eta = formatDuration((elapsed / done) * (total - done));
  }
  return (
    <div className="mt-1">
      <p className="text-xs text-muted">
        {STAGE_LABEL[stage]}
        {counting && ` · ${done.toLocaleString('es')} de ${total.toLocaleString('es')} fragmentos (${Math.floor((done / total) * 100)} %)`}
        {eta && ` · faltan ~${eta}`}
      </p>
      <ProgressBar value={counting ? done / total : 0} indeterminate={!counting} />
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsPanel({ projectId }: { projectId: string }) {
  const [documents, setDocuments] = useState<DocumentItem[] | null>(null);
  const [uploading, setUploading] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await api.documents(projectId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    api.documents(projectId).then(setDocuments, (e) => setError(e.message));
  }, [projectId]);

  // Mientras haya documentos en proceso, consultar el estado cada 3 segundos.
  const busy = documents?.some((d) => d.status === 'pending' || d.status === 'processing');
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [busy, refresh]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files);
    // Se muestran todos en espera; se suben de a uno para no saturar la conexión.
    setUploading(list.map((f) => ({ name: f.name, loaded: 0, total: f.size })));
    for (const file of list) {
      try {
        await api.uploadDocument(projectId, file, (loaded, total) =>
          setUploading((u) => u.map((x) => (x.name === file.name ? { ...x, loaded, total } : x))),
        );
        await refresh();
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
      } finally {
        setUploading((u) => u.filter((x) => x.name !== file.name));
      }
    }
    if (inputRef.current) inputRef.current.value = '';
    await refresh();
  }

  async function reprocess(doc: DocumentItem) {
    setError(null);
    try {
      await api.processDocument(doc.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(doc: DocumentItem) {
    if (!confirm(`¿Eliminar "${doc.name}"? Ya no se podrá consultar.`)) return;
    setError(null);
    try {
      await api.deleteDocument(doc.id);
      setDocuments((list) => list?.filter((d) => d.id !== doc.id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const ready = documents?.filter((d) => d.status === 'ready').length ?? 0;
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-5">
      <SectionTitle aside={documents && <span className="text-xs text-muted">{ready} listo{ready === 1 ? '' : 's'}</span>}>
        Documentos
      </SectionTitle>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading.length > 0}
        className="flex flex-col items-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-line-strong bg-[#fbfbfc] px-4 py-5 text-center text-[13px] text-ink-2 transition hover:border-brand hover:bg-brand-soft disabled:opacity-60"
      >
        <UploadIcon size={22} />
        <span>
          <strong>{uploading.length ? 'Subiendo…' : 'Sube archivos'}</strong>
        </span>
        <span className="text-xs text-muted">PDF (también escaneados), Word, Excel, CSV, TXT, Markdown o imágenes · 50 MB</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />
      <ErrorText>{error}</ErrorText>

      <ul className="max-h-[50vh] space-y-2 overflow-y-auto xl:max-h-none">
        {uploading.map((u) => (
          <li key={u.name} className="rounded-xl border border-line p-3 text-sm">
            <p className="truncate font-medium text-ink-2" title={u.name}>{u.name}</p>
            <p className="text-xs text-muted">
              {u.loaded === 0
                ? 'Esperando para subir…'
                : u.loaded >= u.total
                  ? 'Subido · preparando el procesamiento…'
                  : `Subiendo · ${formatSize(u.loaded)} de ${formatSize(u.total)} (${Math.floor((u.loaded / u.total) * 100)} %)`}
            </p>
            <ProgressBar value={u.total ? u.loaded / u.total : 0} indeterminate={u.loaded === 0} />
          </li>
        ))}
        {!documents && !error && <Spinner />}
        {documents?.length === 0 && uploading.length === 0 && (
          <li className="text-sm text-muted">Sube documentos para empezar a consultarlos.</li>
        )}
        {documents?.map((doc) => {
          const status = STATUS_LABEL[doc.status];
          return (
            <li key={doc.id} className="rounded-xl border border-line p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={doc.name}>
                    {doc.name}
                  </p>
                  <p className="text-xs text-muted">
                    {formatSize(doc.size_bytes)}
                    {doc.chunk_count > 0 && ` · ${doc.chunk_count} fragmentos`}
                  </p>
                </div>
                <span className="shrink-0">
                  <Badge tone={status.tone}>{status.text}</Badge>
                </span>
              </div>
              {(doc.status === 'pending' || doc.status === 'processing') && <ProcessingProgress doc={doc} />}
              {doc.error && <p className="mt-2 text-xs text-red-700">{doc.error}</p>}
              <div className="mt-2 flex gap-3 text-xs">
                {(doc.status === 'failed' || doc.status === 'ready' || doc.status === 'uploading') && (
                  <button type="button" className="font-medium text-brand hover:text-brand-hover" onClick={() => void reprocess(doc)}>
                    {doc.status === 'ready' ? 'Reprocesar' : 'Reintentar'}
                  </button>
                )}
                <button type="button" className="text-red-700 hover:text-red-900" onClick={() => void remove(doc)}>
                  Eliminar
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
