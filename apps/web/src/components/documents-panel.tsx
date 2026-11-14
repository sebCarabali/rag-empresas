'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ACCEPTED_FILES, api, type DocumentItem, type DocumentStatus } from '@/lib/api';
import { Button, ErrorText, Spinner } from './ui';

const STATUS_LABEL: Record<DocumentStatus, { text: string; className: string }> = {
  uploading: { text: 'Subiendo', className: 'bg-slate-100 text-slate-600' },
  pending: { text: 'En cola', className: 'bg-amber-100 text-amber-800' },
  processing: { text: 'Procesando', className: 'bg-blue-100 text-blue-800' },
  ready: { text: 'Listo', className: 'bg-emerald-100 text-emerald-800' },
  failed: { text: 'Error', className: 'bg-red-100 text-red-700' },
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
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}
    >
      <div
        className={`h-full rounded-full bg-blue-600 transition-[width] duration-500 ${indeterminate ? 'w-1/3 animate-pulse' : ''}`}
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
      <p className="text-xs text-slate-600">
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

  return (
    <section className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Documentos</h2>
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={uploading.length > 0}>
          {uploading.length ? 'Subiendo…' : 'Subir archivos'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>
      <p className="text-xs text-slate-500">PDF (también escaneados), Word, Excel (.xlsx), CSV, TXT, Markdown o imágenes (PNG, JPG, WebP) · máximo 50 MB. Los escaneos e imágenes se leen con OCR de Gemini.</p>
      <ErrorText>{error}</ErrorText>

      <ul className="flex-1 space-y-2 overflow-y-auto">
        {uploading.map((u) => (
          <li key={u.name} className="rounded-lg border border-dashed border-slate-300 p-3 text-sm">
            <p className="truncate font-medium text-slate-700" title={u.name}>{u.name}</p>
            <p className="text-xs text-slate-500">
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
          <li className="text-sm text-slate-500">Sube documentos para empezar a consultarlos.</li>
        )}
        {documents?.map((doc) => {
          const status = STATUS_LABEL[doc.status];
          return (
            <li key={doc.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={doc.name}>
                    {doc.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatSize(doc.size_bytes)}
                    {doc.chunk_count > 0 && ` · ${doc.chunk_count} fragmentos`}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                  {status.text}
                </span>
              </div>
              {(doc.status === 'pending' || doc.status === 'processing') && <ProcessingProgress doc={doc} />}
              {doc.error && <p className="mt-2 text-xs text-red-600">{doc.error}</p>}
              <div className="mt-2 flex gap-3 text-xs">
                {(doc.status === 'failed' || doc.status === 'ready' || doc.status === 'uploading') && (
                  <button className="text-slate-600 hover:text-slate-900" onClick={() => void reprocess(doc)}>
                    {doc.status === 'ready' ? 'Reprocesar' : 'Reintentar'}
                  </button>
                )}
                <button className="text-red-600 hover:text-red-800" onClick={() => void remove(doc)}>
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
