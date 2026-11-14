'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { widgetApi } from '@/lib/api';

type WidgetConfig = Awaited<ReturnType<typeof widgetApi.config>>;

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ index: number; documentName: string; page?: number }>;
  streaming?: boolean;
}

/** Chat que se muestra dentro del iframe del widget, en el sitio de la empresa. */
export function WidgetChat() {
  const { publicKey } = useParams<{ publicKey: string }>();
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    widgetApi.config(publicKey).then(setConfig, () => setUnavailable(true));
  }, [publicKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  async function send(text?: string, e?: FormEvent) {
    e?.preventDefault();
    const question = (text ?? input).trim();
    if (!question || sending) return;
    setInput('');
    setError(null);
    setSending(true);

    // El historial vive solo en el navegador del visitante (últimos 10 mensajes).
    const history = turns.filter((t) => !t.streaming).slice(-10).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: 'user', content: question }, { role: 'assistant', content: '', streaming: true }]);
    const update = (fn: (t: Turn) => Turn) =>
      setTurns((list) => list.map((t, i) => (i === list.length - 1 ? fn(t) : t)));

    abortRef.current = new AbortController();
    try {
      await widgetApi.ask(
        publicKey,
        question,
        history,
        (event) => {
          if (event.type === 'delta') update((t) => ({ ...t, content: t.content + event.text }));
          else if (event.type === 'reset') update((t) => ({ ...t, content: '' }));
          else if (event.type === 'sources') update((t) => ({ ...t, sources: event.sources }));
          else if (event.type === 'error') setError(event.message);
        },
        abortRef.current.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError('No se pudo conectar. Intenta de nuevo.');
    } finally {
      update((t) => ({ ...t, streaming: false }));
      setTurns((list) => list.filter((t) => t.streaming || t.content || t.role === 'user'));
      setSending(false);
    }
  }

  if (unavailable) {
    return <div className="flex h-screen items-center justify-center p-6 text-sm text-slate-500">El asistente no está disponible.</div>;
  }
  if (!config) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-400">Cargando…</div>;
  }

  const color = config.primaryColor;
  return (
    <div className="flex h-screen flex-col bg-white text-sm">
      <header className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: color }}>
        {config.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.avatarUrl} alt="" className="h-8 w-8 rounded-full bg-white object-cover" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 font-semibold">
            {config.name.charAt(0).toUpperCase()}
          </div>
        )}
        <p className="flex-1 font-semibold">{config.name}</p>
        <button
          onClick={() => window.parent.postMessage('rag-widget-close', '*')}
          className="rounded p-1 text-white/80 hover:text-white"
          aria-label="Cerrar"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="space-y-3">
            <div className="max-w-[85%] rounded-2xl bg-slate-100 px-3 py-2">
              {config.welcomeMessage || `¡Hola! Soy ${config.name}. ¿En qué te puedo ayudar?`}
            </div>
            {config.suggestedQuestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {config.suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => void send(q)}
                    className="rounded-full border px-3 py-1 text-left text-xs hover:bg-slate-50"
                    style={{ borderColor: color, color }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${t.role === 'user' ? 'text-white' : 'bg-slate-100'}`}
              style={t.role === 'user' ? { background: color } : undefined}
            >
              {t.content || (t.streaming && <span className="animate-pulse text-slate-500">Escribiendo…</span>)}
              {t.role === 'assistant' && !t.streaming && config.showSources && t.sources && t.sources.length > 0 && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Fuentes: {t.sources.map((s) => `[${s.index}] ${s.documentName}${s.page ? ` p.${s.page}` : ''}`).join(' · ')}
                </p>
              )}
            </div>
          </div>
        ))}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={(e) => void send(undefined, e)} className="flex gap-2 border-t p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={1000}
          placeholder="Escribe tu pregunta…"
          className="flex-1 rounded-full border border-slate-300 px-4 py-2 outline-none focus:border-slate-500"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-full px-4 py-2 font-medium text-white disabled:opacity-50"
          style={{ background: color }}
        >
          Enviar
        </button>
      </form>
      <p className="pb-2 text-center text-[10px] text-slate-400">Respuestas generadas con IA; pueden contener errores.</p>
    </div>
  );
}
