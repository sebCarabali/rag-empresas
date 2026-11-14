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

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsPanel({ projectId }: { projectId: string }) {
  const [documents, setDocuments] = useState<DocumentItem[] | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
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
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [busy, refresh]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      setUploading((u) => [...u, file.name]);
      try {
        await api.uploadDocument(projectId, file);
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
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
        {uploading.map((name) => (
          <li key={name} className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
            Subiendo {name}…
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
