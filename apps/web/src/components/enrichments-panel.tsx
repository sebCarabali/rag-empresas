'use client';

import { useEffect, useState } from 'react';
import { api, type Enrichment } from '@/lib/api';
import { ErrorText } from './ui';

/**
 * Descripciones generales (web) de familias y tipos de tela, generadas al
 * procesar un CSV. Permite revisarlas y regenerarlas.
 */
export function EnrichmentsPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Enrichment[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api.enrichments(projectId).then(
      (r) => {
        setItems(r.items);
        setEnabled(r.enabled);
      },
      (e) => setError(e.message),
    );
  }, [projectId, tick]);

  // Mientras haya descripciones pendientes, actualizar cada 5 segundos.
  const pending = items?.some((i) => i.status === 'pending');
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(timer);
  }, [pending]);

  async function refresh(force: boolean) {
    if (force && !confirm('¿Regenerar todas las descripciones? Vuelve a usar búsquedas web.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.refreshEnrichments(projectId, force);
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!enabled || !items || items.length === 0) {
    return error ? <ErrorText>{error}</ErrorText> : null;
  }

  const ready = items.filter((i) => i.status === 'ready').length;
  const failed = items.filter((i) => i.status === 'failed');

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <summary className="cursor-pointer select-none font-medium">
        Descripciones web · {ready}/{items.length}
        {pending && <span className="ml-1 animate-pulse text-xs text-blue-700">generando…</span>}
      </summary>
      <p className="mt-2 text-xs text-slate-500">
        Información general de cada familia y tipo de tela, obtenida de internet. El chat la usa para explicar las
        telas; los datos técnicos siempre salen de tu catálogo.
      </p>
      <ErrorText>{error}</ErrorText>
      {failed.length > 0 && (
        <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {failed.length} con error: {failed[0].error}
        </p>
      )}
      <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
        {items.map((item) => (
          <li key={item.id} className="rounded-md bg-slate-50 p-2">
            <p className="text-xs font-medium">
              {item.field}: {item.value}
              {item.status !== 'ready' && (
                <span className={`ml-1 ${item.status === 'failed' ? 'text-red-600' : 'text-slate-400'}`}>
                  ({item.status === 'failed' ? 'error' : 'pendiente'})
                </span>
              )}
            </p>
            {item.description && <p className="mt-1 text-xs text-slate-600">{item.description}</p>}
            {item.sources.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-2 text-[11px]">
                {item.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                    {s.title}
                  </a>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-3 text-xs">
        {failed.length > 0 && (
          <button disabled={busy} onClick={() => void refresh(false)} className="text-slate-700 hover:text-slate-900">
            Reintentar fallidas
          </button>
        )}
        <button disabled={busy} onClick={() => void refresh(true)} className="text-slate-500 hover:text-slate-900">
          Regenerar todas
        </button>
      </div>
    </details>
  );
}
