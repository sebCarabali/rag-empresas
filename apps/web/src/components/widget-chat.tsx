'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { WidgetTokenError, widgetApi } from '@/lib/api';
import { FeedbackButtons } from './feedback-buttons';
import { CloseIcon, SendIcon } from './icons';

type WidgetConfig = Awaited<ReturnType<typeof widgetApi.config>>;

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ index: number; documentName: string; page?: number }>;
  streaming?: boolean;
  /** Id del registro en el servidor, para valorar la respuesta. */
  messageId?: string | null;
  sessionId?: string;
}

/** Sesión anónima del visitante: agrupa sus preguntas y le permite valorar sus respuestas. */
function visitorSession(): string {
  try {
    const saved = sessionStorage.getItem('rag-widget-session');
    if (saved) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem('rag-widget-session', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
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
  const sessionRef = useRef<string | null>(null);
  // Modo protegido: token temporal emitido por el servidor de la empresa (llega en el # del iframe).
  const tokenRef = useRef<string | null>(null);
  const tokenWaiters = useRef<Array<(token: string | null) => void>>([]);

  useEffect(() => {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('t');
    if (fromHash) tokenRef.current = fromHash;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || !e.data || e.data.type !== 'rag-widget-token') return;
      tokenRef.current = String(e.data.token || '') || null;
      tokenWaiters.current.splice(0).forEach((resolve) => resolve(tokenRef.current));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /** Pide un token nuevo al sitio que inserta el widget y espera hasta 6 s. */
  function renewToken(): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 6000);
      tokenWaiters.current.push((t) => {
        clearTimeout(timer);
        resolve(t);
      });
      window.parent.postMessage({ type: 'rag-widget-token-expired' }, '*');
    });
  }

  useEffect(() => {
    widgetApi.config(publicKey).then(
      (cfg) => {
        setConfig(cfg);
        // Aviso al sitio que inserta el widget (lo usa la página de prueba para el diagnóstico).
        window.parent.postMessage({ type: 'rag-widget-ready', name: cfg.name }, '*');
      },
      () => {
        setUnavailable(true);
        window.parent.postMessage({ type: 'rag-widget-unavailable' }, '*');
      },
    );
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
    sessionRef.current ??= visitorSession();
    try {
      const ask = () =>
        widgetApi.ask(
          publicKey,
          question,
          history,
          sessionRef.current!,
          (event) => {
            if (event.type === 'delta') update((t) => ({ ...t, content: t.content + event.text }));
            else if (event.type === 'reset') update((t) => ({ ...t, content: '' }));
            else if (event.type === 'sources') update((t) => ({ ...t, sources: event.sources }));
            else if (event.type === 'done') update((t) => ({ ...t, messageId: event.messageId ?? null, sessionId: event.sessionId }));
            else if (event.type === 'error') setError(event.message);
          },
          abortRef.current!.signal,
          tokenRef.current,
        );
      try {
        await ask();
      } catch (err) {
        if (!(err instanceof WidgetTokenError)) throw err;
        // El token venció: se pide otro al sitio de la empresa y se reintenta una vez.
        if (await renewToken()) await ask();
        else setError('La sesión del chat venció. Recarga la página para seguir conversando.');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError('No se pudo conectar. Intenta de nuevo.');
    } finally {
      update((t) => ({ ...t, streaming: false }));
      setTurns((list) => list.filter((t) => t.streaming || t.content || t.role === 'user'));
      setSending(false);
    }
  }

  if (unavailable) {
    return <div className="flex h-screen items-center justify-center p-6 text-sm text-muted">El asistente no está disponible.</div>;
  }
  if (!config) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted">Cargando…</div>;
  }

  const color = config.primaryColor;
  return (
    <div className="flex h-screen flex-col bg-white text-sm">
      <header className="flex items-center gap-3 px-4 py-3.5 text-white" style={{ background: color }}>
        {config.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.avatarUrl} alt="" className="h-9 w-9 rounded-xl bg-white object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 font-semibold" aria-hidden="true">
            {config.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <p className="truncate text-[15px] font-semibold">{config.name}</p>
          <p className="truncate text-xs opacity-85">Responde con los documentos de la empresa</p>
        </div>
        <button
          type="button"
          onClick={() => window.parent.postMessage('rag-widget-close', '*')}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/90 hover:bg-white/15 hover:text-white"
          aria-label="Cerrar"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="flex-1 space-y-3.5 overflow-y-auto bg-[#fafafb] p-4">
        {turns.length === 0 && (
          <div className="space-y-3">
            <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-[#eceef2] bg-white px-3.5 py-2.5 leading-relaxed">
              {config.welcomeMessage || `¡Hola! Soy ${config.name}. ¿En qué te puedo ayudar?`}
            </div>
            {config.suggestedQuestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {config.suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void send(q)}
                    className="min-h-9 rounded-full border bg-white px-3 py-1.5 text-left text-[13px] hover:bg-[#f4f5f7]"
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
            <div className="flex max-w-[88%] flex-col gap-2">
              <div
                className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 leading-relaxed ${
                  t.role === 'user' ? 'rounded-br-md text-white' : 'rounded-bl-md border border-[#eceef2] bg-white'
                }`}
                style={t.role === 'user' ? { background: color } : undefined}
              >
                {t.content || (t.streaming && <span className="animate-pulse text-muted">Escribiendo…</span>)}
                {t.role === 'assistant' && !t.streaming && config.showSources && t.sources && t.sources.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted">
                    Fuentes: {t.sources.map((s) => `[${s.index}] ${s.documentName}${s.page ? ` p.${s.page}` : ''}`).join(' · ')}
                  </p>
                )}
              </div>
              {t.role === 'assistant' && !t.streaming && t.messageId && t.sessionId && (
                <FeedbackButtons
                  color={color}
                  onRate={(rating, comment) =>
                    widgetApi.rate(publicKey, t.messageId!, t.sessionId!, rating, comment, tokenRef.current)
                  }
                />
              )}
            </div>
          </div>
        ))}
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={(e) => void send(undefined, e)} className="flex gap-2 border-t border-[#eceef2] p-3">
        <label htmlFor="w-pregunta" className="sr-only">
          Escribe tu pregunta
        </label>
        <input
          id="w-pregunta"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={1000}
          placeholder="Escribe tu pregunta…"
          className="h-11 flex-1 rounded-xl border border-line-strong px-3.5 outline-none focus:border-[#9aa3b2]"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="Enviar"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-white disabled:opacity-40"
          style={{ background: color }}
        >
          <SendIcon />
        </button>
      </form>
      <p className="pb-2.5 text-center text-[11px] text-muted">Respuestas generadas con IA; pueden contener errores.</p>
    </div>
  );
}
