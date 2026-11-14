'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type Chatbot } from '@/lib/api';
import { Header } from './header';
import { Button, Card, ErrorText, Input, Spinner } from './ui';

const LANGUAGES = [
  { value: 'auto', label: 'El mismo idioma de la pregunta' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'pt', label: 'Portugués' },
] as const;

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** Personalización del asistente del proyecto y configuración del widget para el sitio web. */
export function ChatbotSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const [projectName, setProjectName] = useState('');
  const [bot, setBot] = useState<Chatbot | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [messagesToday, setMessagesToday] = useState(0);
  const [questions, setQuestions] = useState('');
  const [origins, setOrigins] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.project(projectId).then((p) => setProjectName(p.name), () => undefined);
    api.chatbot(projectId).then(
      (r) => {
        setBot(r.chatbot);
        setCanEdit(r.canEdit);
        setMessagesToday(r.messagesToday);
        setQuestions(r.chatbot.suggested_questions.join('\n'));
        setOrigins(r.chatbot.allowed_origins.join('\n'));
      },
      (e) => setError(e.message),
    );
  }, [projectId]);

  const set = <K extends keyof Chatbot>(key: K, value: Chatbot[K]) => {
    setSaved(false);
    setBot((b) => (b ? { ...b, [key]: value } : b));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!bot) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.saveChatbot(projectId, {
        name: bot.name,
        welcome_message: bot.welcome_message,
        instructions: bot.instructions,
        suggested_questions: lines(questions).slice(0, 6),
        primary_color: bot.primary_color,
        avatar_url: bot.avatar_url,
        language: bot.language,
        widget_enabled: bot.widget_enabled,
        allowed_origins: lines(origins),
        daily_message_limit: bot.daily_message_limit,
        widget_show_sources: bot.widget_show_sources,
      });
      setBot(updated);
      setOrigins(updated.allowed_origins.join('\n'));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function rotate() {
    if (!confirm('¿Generar una clave nueva? El código que ya pusiste en tu sitio dejará de funcionar hasta que lo actualices.')) return;
    try {
      setBot(await api.rotateChatbotKey(projectId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const snippet = bot?.public_key
    ? `<script src="${appUrl}/widget.js" data-bot="${bot.public_key}" async></script>`
    : '';

  return (
    <>
      <Header>
        <Link href="/dashboard" className="hover:text-slate-900">Proyectos</Link>
        <span>/</span>
        <Link href={`/projects/${projectId}`} className="hover:text-slate-900">{projectName || 'Proyecto'}</Link>
        <span>/</span>
        <span className="font-medium text-slate-900">Asistente</span>
      </Header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-6 py-8">
        <ErrorText>{error}</ErrorText>
        {!bot && !error && <Spinner />}
        {bot && (
          <form onSubmit={save} className="space-y-6">
            {!canEdit && (
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
                Solo owner o admin pueden cambiar esta configuración.
              </p>
            )}
            <fieldset disabled={!canEdit} className="space-y-6">
              <Card className="space-y-4">
                <h2 className="font-semibold">Personalización</h2>
                <p className="text-sm text-slate-500">Se aplica al chat de la app y al widget de tu sitio web.</p>
                <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                  <Field label="Nombre del asistente">
                    <Input value={bot.name} maxLength={60} required onChange={(e) => set('name', e.target.value)} />
                  </Field>
                  <Field label="Color">
                    <input
                      type="color"
                      value={bot.primary_color}
                      onChange={(e) => set('primary_color', e.target.value)}
                      className="h-9 w-16 cursor-pointer rounded border border-slate-300"
                    />
                  </Field>
                </div>
                <Field label="Logo o avatar (URL https, opcional)">
                  <Input
                    type="url"
                    placeholder="https://www.tuempresa.com/logo.png"
                    value={bot.avatar_url ?? ''}
                    onChange={(e) => set('avatar_url', e.target.value || null)}
                  />
                </Field>
                <Field label="Mensaje de bienvenida">
                  <Input
                    maxLength={500}
                    placeholder="¡Hola! Soy el asistente de Tekstelas. Pregúntame por nuestras telas."
                    value={bot.welcome_message ?? ''}
                    onChange={(e) => set('welcome_message', e.target.value || null)}
                  />
                </Field>
                <Field
                  label="Instrucciones para el asistente"
                  hint="Tono, estilo y temas. Ej.: «Responde de forma breve y amable, tutea al cliente, recomienda siempre pedir una muestra». No puede saltarse las reglas de seguridad ni inventar datos."
                >
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={bot.instructions ?? ''}
                    onChange={(e) => set('instructions', e.target.value || null)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                  />
                </Field>
                <Field label="Preguntas sugeridas (una por línea, máximo 6)">
                  <textarea
                    rows={4}
                    value={questions}
                    onChange={(e) => {
                      setSaved(false);
                      setQuestions(e.target.value);
                    }}
                    placeholder={'¿Qué telas de algodón tienen?\n¿Cuál es la tela más liviana?'}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                  />
                </Field>
                <Field label="Idioma de las respuestas">
                  <select
                    value={bot.language}
                    onChange={(e) => set('language', e.target.value as Chatbot['language'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </Field>
              </Card>

              <Card className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Widget para tu sitio web</h2>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={bot.widget_enabled}
                      onChange={(e) => set('widget_enabled', e.target.checked)}
                    />
                    Activado
                  </label>
                </div>
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <strong>Importante:</strong> el widget es público. Cualquier visitante de tu sitio podrá hacer preguntas
                  sobre <strong>todos los documentos de este proyecto</strong>. Actívalo solo en proyectos con información que
                  pueda ver un cliente (por ejemplo, el catálogo), nunca con documentos internos.
                </p>
                <Field label="Dominios autorizados (uno por línea)" hint="Solo en estos sitios se podrá mostrar el widget. Ej.: https://www.tuempresa.com">
                  <textarea
                    rows={3}
                    value={origins}
                    onChange={(e) => {
                      setSaved(false);
                      setOrigins(e.target.value);
                    }}
                    placeholder="https://www.tuempresa.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-slate-900"
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Límite de mensajes por día" hint={`Hoy: ${messagesToday} mensajes`}>
                    <Input
                      type="number"
                      min={1}
                      max={100000}
                      value={bot.daily_message_limit}
                      onChange={(e) => set('daily_message_limit', Number(e.target.value))}
                    />
                  </Field>
                  <label className="flex items-center gap-2 self-center text-sm">
                    <input
                      type="checkbox"
                      checked={bot.widget_show_sources}
                      onChange={(e) => set('widget_show_sources', e.target.checked)}
                    />
                    Mostrar fuentes a los visitantes
                  </label>
                </div>

                {bot.public_key ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Código para insertar</p>
                    <p className="text-xs text-slate-500">Pégalo antes de &lt;/body&gt; en las páginas de tu sitio.</p>
                    <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{snippet}</pre>
                    <div className="flex flex-wrap gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(snippet);
                          setCopied(true);
                        }}
                        className="font-medium text-slate-700 hover:text-slate-900"
                      >
                        {copied ? 'Copiado ✓' : 'Copiar código'}
                      </button>
                      {bot.widget_enabled && (
                        <a href={`/embed/${bot.public_key}`} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:text-slate-900">
                          Probar el widget
                        </a>
                      )}
                      <button type="button" onClick={() => void rotate()} className="text-red-600 hover:text-red-800">
                        Generar clave nueva
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Guarda la configuración para obtener el código del widget.</p>
                )}
              </Card>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
                {saved && <span className="text-sm text-emerald-700">Guardado ✓</span>}
              </div>
            </fieldset>
          </form>
        )}
      </main>
    </>
  );
}
