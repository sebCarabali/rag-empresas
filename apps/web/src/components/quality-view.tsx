'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type EvalCase,
  type EvalResult,
  type EvalRun,
  type FeedbackItem,
  type ModelInfo,
  type WidgetMessage,
} from '@/lib/api';
import { Header } from './header';
import { Button, Card, ErrorText, Input, Spinner } from './ui';

type Tab = 'feedback' | 'widget' | 'evals';
type RatingFilter = 'all' | 'up' | 'down';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'feedback', label: 'Valoraciones del equipo' },
  { id: 'widget', label: 'Preguntas del sitio web' },
  { id: 'evals', label: 'Pruebas automáticas' },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });

const modelLabel = (m: ModelInfo | null) =>
  m ? `${m.provider === 'groq' ? 'Groq' : 'Gemini'} · ${m.model}` : null;

const splitList = (text: string) =>
  text
    .split(/[\n;]/)
    .map((t) => t.trim())
    .filter(Boolean);

/** Calidad de respuestas: valoraciones, conversaciones del widget y pruebas automáticas. */
export function QualityView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [projectName, setProjectName] = useState('');
  const [tab, setTab] = useState<Tab>('feedback');

  useEffect(() => {
    api.project(projectId).then((p) => setProjectName(p.name), () => undefined);
  }, [projectId]);

  return (
    <>
      <Header>
        <Link href="/dashboard" className="hover:text-slate-900">Proyectos</Link>
        <span>/</span>
        <Link href={`/projects/${projectId}`} className="hover:text-slate-900">{projectName || 'Proyecto'}</Link>
        <span>/</span>
        <span className="font-medium text-slate-900">Calidad</span>
      </Header>
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-8">
        <nav className="flex flex-wrap gap-2 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                tab === t.id ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {tab === 'feedback' && <FeedbackTab projectId={projectId} />}
        {tab === 'widget' && <WidgetTab projectId={projectId} />}
        {tab === 'evals' && <EvalsTab projectId={projectId} />}
      </main>
    </>
  );
}

function RatingFilterBar({ value, onChange }: { value: RatingFilter; onChange: (v: RatingFilter) => void }) {
  const options: Array<[RatingFilter, string]> = [
    ['all', 'Todas'],
    ['down', '👎 Negativas'],
    ['up', '👍 Positivas'],
  ];
  return (
    <div className="flex gap-2">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-full border px-3 py-1 text-xs ${value === v ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function QA({ question, answer, meta }: { question: string | null; answer: string | null; meta?: string | null }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-slate-900">{question ?? '(pregunta no disponible)'}</p>
      <details>
        <summary className="cursor-pointer select-none text-xs text-slate-500">Ver respuesta{meta ? ` · ${meta}` : ''}</summary>
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-700">{answer}</p>
      </details>
    </div>
  );
}

function FeedbackTab({ projectId }: { projectId: string }) {
  const [filter, setFilter] = useState<RatingFilter>('down');
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.feedback(projectId, filter).then(
      (list) => !cancelled && setItems(list),
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, filter]);

  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600">
        Respuestas del chat interno valoradas con 👍/👎. Los administradores ven las de todo el equipo; el resto, solo las suyas.
        Las negativas suelen indicar documentos faltantes o preguntas que conviene agregar a las pruebas automáticas.
      </p>
      <RatingFilterBar value={filter} onChange={(v) => { setItems(null); setFilter(v); }} />
      <ErrorText>{error}</ErrorText>
      {!items && !error && <Spinner />}
      {items?.length === 0 && <p className="text-sm text-slate-500">No hay valoraciones con este filtro.</p>}
      <ul className="space-y-3">
        {items?.map((f) => (
          <li key={f.message_id}>
            <Card className="space-y-2 !p-4">
              <p className="text-xs text-slate-500">
                {f.rating === 1 ? '👍' : '👎'} · {fmtDate(f.updated_at)}
              </p>
              <QA question={f.question} answer={f.answer} meta={modelLabel(f.model_info)} />
              {f.comment && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">“{f.comment}”</p>}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WidgetTab({ projectId }: { projectId: string }) {
  const [filter, setFilter] = useState<RatingFilter>('all');
  const [items, setItems] = useState<WidgetMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.widgetMessages(projectId, filter).then(
      (list) => {
        if (cancelled) return;
        setItems(list);
        setHasMore(list.length === 50);
      },
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, filter]);

  async function more() {
    const last = items?.at(-1);
    if (!last) return;
    try {
      const list = await api.widgetMessages(projectId, filter, last.created_at);
      setItems((prev) => [...(prev ?? []), ...list]);
      setHasMore(list.length === 50);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600">
        Lo que preguntan los visitantes de tu sitio web en el widget, con su valoración si la dejaron. Los visitantes son anónimos;
        cada sesión del navegador tiene un identificador aleatorio.
      </p>
      <RatingFilterBar value={filter} onChange={(v) => { setItems(null); setFilter(v); }} />
      <ErrorText>{error}</ErrorText>
      {!items && !error && <Spinner />}
      {items?.length === 0 && <p className="text-sm text-slate-500">Todavía no hay preguntas del widget con este filtro.</p>}
      <ul className="space-y-3">
        {items?.map((m) => (
          <li key={m.id}>
            <Card className="space-y-2 !p-4">
              <p className="text-xs text-slate-500">
                {fmtDate(m.created_at)} · sesión {m.session_id.slice(0, 8)}
                {m.rating === 1 && ' · 👍'}
                {m.rating === -1 && ' · 👎'}
                {m.cached && ' · desde caché'}
              </p>
              <QA question={m.question} answer={m.answer} meta={modelLabel(m.model_info)} />
              {m.feedback_comment && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">“{m.feedback_comment}”</p>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {hasMore && (
        <Button variant="secondary" onClick={() => void more()}>
          Ver más
        </Button>
      )}
    </section>
  );
}

const EMPTY_FORM = { question: '', include: '', exclude: '' };

function EvalsTab({ projectId }: { projectId: string }) {
  const [cases, setCases] = useState<EvalCase[] | null>(null);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [selected, setSelected] = useState<(EvalRun & { results: EvalResult[] }) | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRun = useCallback(
    (runId: string) => api.evalRun(projectId, runId).then(setSelected, (e) => setError(e.message)),
    [projectId],
  );

  useEffect(() => {
    api.evalCases(projectId).then(setCases, (e) => setError(e.message));
    api.evalRuns(projectId).then(
      (list) => {
        setRuns(list);
        if (list[0]) void loadRun(list[0].id);
      },
      (e) => setError(e.message),
    );
  }, [projectId, loadRun]);

  // Mientras una ejecución está en curso, se actualiza cada 4 s.
  const active = selected && (selected.status === 'queued' || selected.status === 'running') ? selected.id : null;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      api.evalRun(projectId, active).then((run) => {
        setSelected(run);
        setRuns((list) => list.map((r) => (r.id === run.id ? { ...r, ...run } : r)));
      }, () => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [projectId, active]);

  async function saveCase(e: FormEvent) {
    e.preventDefault();
    const input = {
      question: form.question.trim(),
      must_include: splitList(form.include),
      must_not_include: splitList(form.exclude),
    };
    if (!input.question) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        const updated = await api.updateEvalCase(projectId, editingId, input);
        setCases((list) => list?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
      } else {
        const created = await api.createEvalCase(projectId, input);
        setCases((list) => [...(list ?? []), created]);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function edit(c: EvalCase) {
    setEditingId(c.id);
    setForm({ question: c.question, include: c.must_include.join('\n'), exclude: c.must_not_include.join('\n') });
  }

  async function removeCase(id: string) {
    if (!confirm('¿Eliminar esta pregunta de prueba?')) return;
    try {
      await api.deleteEvalCase(projectId, id);
      setCases((list) => list?.filter((c) => c.id !== id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const started = await api.startEvalRun(projectId);
      setRuns((list) => [started, ...list]);
      setSelected({ ...started, results: [] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <p className="text-sm text-slate-600">
        Define preguntas y lo que la respuesta debe contener (por ejemplo, una cifra o un nombre de producto). Al ejecutar, cada
        pregunta pasa por el asistente sin usar la caché y se marca como correcta si contiene todos los textos esperados y ninguno
        de los prohibidos. No distingue mayúsculas, tildes ni separadores de miles. Úsalas después de cambiar documentos o
        instrucciones para detectar retrocesos.
      </p>
      <ErrorText>{error}</ErrorText>

      <Card className="space-y-3 !p-4">
        <form onSubmit={saveCase} className="space-y-3">
          <p className="text-sm font-medium">{editingId ? 'Editar pregunta' : 'Nueva pregunta de prueba'}</p>
          <Input
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            maxLength={1000}
            placeholder="¿Cuántas telas pesan menos de 120 g/m²?"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-slate-600">
              <span>Debe contener (uno por línea)</span>
              <textarea
                value={form.include}
                onChange={(e) => setForm({ ...form, include: e.target.value })}
                rows={3}
                placeholder="722"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-600">
              <span>No debe contener (opcional, uno por línea)</span>
              <textarea
                value={form.exclude}
                onChange={(e) => setForm({ ...form, exclude: e.target.value })}
                rows={3}
                placeholder="no encontré"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !form.question.trim()}>
              {editingId ? 'Guardar cambios' : 'Agregar pregunta'}
            </Button>
            {editingId && (
              <Button type="button" variant="secondary" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Preguntas ({cases?.length ?? 0})</p>
          <Button onClick={() => void run()} disabled={busy || !cases?.length || Boolean(active)}>
            {active ? 'Ejecutando…' : 'Ejecutar pruebas'}
          </Button>
        </div>
        {!cases && <Spinner />}
        {cases?.length === 0 && <p className="text-sm text-slate-500">Aún no hay preguntas de prueba.</p>}
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {cases?.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.question}</p>
                <p className="text-xs text-slate-500">
                  {c.must_include.length > 0 && <>Debe contener: {c.must_include.join(' · ')}</>}
                  {c.must_not_include.length > 0 && <> · No debe contener: {c.must_not_include.join(' · ')}</>}
                </p>
              </div>
              <button onClick={() => edit(c)} className="text-xs text-slate-600 hover:text-slate-900">Editar</button>
              <button onClick={() => void removeCase(c.id)} className="text-xs text-red-600 hover:text-red-800">Eliminar</button>
            </li>
          ))}
        </ul>
      </div>

      {runs.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">Ejecuciones</p>
            <select
              value={selected?.id ?? ''}
              onChange={(e) => void loadRun(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {fmtDate(r.created_at)} · {r.status === 'done' ? `${r.passed}/${r.total} correctas` : statusLabel(r.status)}
                </option>
              ))}
            </select>
          </div>
          {selected && <RunDetail run={selected} />}
        </div>
      )}
    </section>
  );
}

function statusLabel(status: EvalRun['status']) {
  return { queued: 'en cola', running: 'ejecutando', done: 'terminada', failed: 'falló' }[status];
}

function RunDetail({ run }: { run: EvalRun & { results: EvalResult[] } }) {
  const done = run.results.length;
  const passed = run.results.filter((r) => r.passed).length;
  return (
    <Card className="space-y-3 !p-4">
      <p className="text-sm">
        {run.status === 'done' || run.status === 'failed' ? (
          <>
            <strong className={passed === done ? 'text-emerald-700' : 'text-amber-700'}>
              {passed}/{done} correctas
            </strong>
            {run.status === 'failed' && <span className="text-red-600"> · la ejecución falló: {run.error}</span>}
          </>
        ) : (
          <span className="animate-pulse">
            {statusLabel(run.status)} · {done}/{run.total} preguntas
          </span>
        )}
      </p>
      <ul className="space-y-2">
        {run.results.map((r) => (
          <li key={r.id} className={`rounded-lg border px-3 py-2 ${r.passed ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'}`}>
            <p className="text-sm">
              {r.passed ? '✅' : '❌'} <span className="font-medium">{r.question}</span>
              {r.duration_ms !== null && <span className="text-xs text-slate-500"> · {(r.duration_ms / 1000).toFixed(1)} s</span>}
            </p>
            {r.missing.length > 0 && <p className="text-xs text-red-700">Faltó: {r.missing.join(' · ')}</p>}
            {r.forbidden.length > 0 && <p className="text-xs text-red-700">Contiene lo prohibido: {r.forbidden.join(' · ')}</p>}
            {r.error && <p className="text-xs text-red-700">Error: {r.error}</p>}
            <details>
              <summary className="cursor-pointer select-none text-xs text-slate-500">
                Ver respuesta{modelLabel(r.model_info) ? ` · ${modelLabel(r.model_info)}` : ''}
              </summary>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.answer || '(sin respuesta)'}</p>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  );
}
