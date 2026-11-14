'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, type Chatbot, type Conversation, type Feedback, type Message, type ModelInfo, type Source, type ToolCall } from '@/lib/api';
import { FeedbackButtons } from './feedback-buttons';
import { Button, ErrorText } from './ui';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  toolCalls?: ToolCall[];
  modelInfo?: ModelInfo | null;
  cached?: boolean;
  streaming?: boolean;
  feedback?: Feedback | null;
}

export function ChatPanel({ projectId, bot }: { projectId: string; bot?: Chatbot | null }) {
  const color = bot?.primary_color ?? '#0f172a';
  const botName = bot?.name ?? 'Asistente';
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tempId = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.conversations(projectId).then(
      (list) => {
        setConversations(list);
        setActiveId(list[0]?.id ?? null);
      },
      (e) => setError(e.message),
    );
  }, [projectId]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    api.messages(activeId).then(
      (list: Message[]) =>
        !cancelled &&
        setMessages(list.map((m) => ({ ...m, toolCalls: m.tool_calls ?? [], modelInfo: m.model_info ?? null }))),
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function newConversation(): Promise<string> {
    const conv = await api.createConversation(projectId);
    setConversations((list) => [conv, ...list]);
    setActiveId(conv.id);
    setMessages([]);
    return conv.id;
  }

  async function removeConversation(id: string) {
    if (!confirm('¿Eliminar esta conversación?')) return;
    try {
      await api.deleteConversation(id);
      setConversations((list) => list.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function send(e?: FormEvent, text?: string) {
    e?.preventDefault();
    const question = (text ?? input).trim();
    if (!question || sending) return;
    setError(null);
    setSending(true);
    setInput('');

    try {
      const conversationId = activeId ?? (await newConversation());
      tempId.current += 1;
      const assistantId = `tmp-${tempId.current}`;
      setMessages((m) => [
        ...m,
        { id: `${assistantId}-q`, role: 'user', content: question, sources: [] },
        { id: assistantId, role: 'assistant', content: '', sources: [], streaming: true },
      ]);
      const update = (fn: (msg: ChatMessage) => ChatMessage) =>
        setMessages((m) => m.map((msg) => (msg.id === assistantId ? fn(msg) : msg)));

      abortRef.current = new AbortController();
      await api.ask(
        conversationId,
        question,
        {
          onSources: (sources) => update((msg) => ({ ...msg, sources })),
          onDelta: (text) => update((msg) => ({ ...msg, content: msg.content + text })),
          onTool: (call) => update((msg) => ({ ...msg, toolCalls: [...(msg.toolCalls ?? []), call] })),
          onModel: (info) => update((msg) => ({ ...msg, modelInfo: info })),
          onReset: () => update((msg) => ({ ...msg, content: '', toolCalls: [] })),
          onDone: ({ messageId, title, cached }) => {
            update((msg) => ({ ...msg, id: messageId, streaming: false, cached }));
            setConversations((list) =>
              list.map((c) => (c.id === conversationId ? { ...c, title } : c)),
            );
          },
          onError: (message) => {
            update((msg) => ({ ...msg, streaming: false }));
            setError(message);
          },
        },
        abortRef.current.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <section className="flex h-full min-h-0 gap-4">
      <aside className="hidden w-56 shrink-0 flex-col gap-2 md:flex">
        <Button variant="secondary" onClick={() => void newConversation().catch((e) => setError(e.message))}>
          Nueva conversación
        </Button>
        <ul className="flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center">
              <button
                onClick={() => setActiveId(c.id)}
                className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${
                  c.id === activeId ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'
                }`}
                title={c.title}
              >
                {c.title}
              </button>
              <button
                onClick={() => void removeConversation(c.id)}
                className="px-1 text-xs text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
                aria-label="Eliminar conversación"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">
              {bot?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bot.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: color }}>
                  {botName.charAt(0).toUpperCase()}
                </div>
              )}
              <p className="font-medium text-slate-800">{botName}</p>
              <p className="max-w-md">{bot?.welcome_message || 'Haz una pregunta sobre los documentos de este proyecto.'}</p>
              {(bot?.suggested_questions.length ?? 0) > 0 && (
                <div className="flex max-w-lg flex-wrap justify-center gap-2">
                  {bot!.suggested_questions.map((q) => (
                    <button
                      key={q}
                      onClick={() => void send(undefined, q)}
                      className="rounded-full border px-3 py-1 text-xs hover:bg-slate-50"
                      style={{ borderColor: color, color }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} color={color} />
          ))}
          <div ref={bottomRef} />
        </div>
        {error && (
          <div className="px-4">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={4000}
            placeholder="Escribe tu pregunta… (Enter para enviar, Shift+Enter para salto de línea)"
            className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
          {sending ? (
            <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>
              Detener
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()}>
              Enviar
            </Button>
          )}
        </form>
      </div>
    </section>
  );
}

function MessageBubble({ message, color }: { message: ChatMessage; color: string }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${isUser ? 'text-white' : 'bg-slate-100 text-slate-900'}`}
        style={isUser ? { background: color } : undefined}
      >
        {!isUser && (message.toolCalls?.length ?? 0) > 0 && (
          <ul className="mb-2 space-y-1">
            {message.toolCalls!.map((call, i) => (
              <li key={i} className="rounded-md bg-white px-2 py-1 text-xs text-slate-600">
                <span className="font-medium">Consulta al catálogo:</span> {call.summary}
                {call.error ? (
                  <span className="text-red-600"> · error</span>
                ) : (
                  call.total !== null && <span> · {call.total.toLocaleString('es')} resultados</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="whitespace-pre-wrap">
          {message.content}
          {message.streaming && !message.content && <span className="animate-pulse">Buscando en los documentos…</span>}
          {message.streaming && message.content && <span className="animate-pulse">▍</span>}
        </p>
        {!isUser && message.modelInfo?.fallback && (
          <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            Respondido con el modelo de respaldo <strong>Groq · {message.modelInfo.model}</strong>
            {message.modelInfo.reason ? ` porque ${message.modelInfo.reason}.` : '.'}
          </p>
        )}
        {!isUser && !message.streaming && (message.modelInfo || message.cached) && (
          <p className="mt-1 text-[11px] text-slate-400">
            {message.modelInfo &&
              `${message.modelInfo.provider === 'groq' ? 'Groq' : 'Gemini'} · ${message.modelInfo.model}${
                message.modelInfo.keyOwner === 'company' ? ' · clave de la empresa' : ''
              }`}
            {message.modelInfo && message.cached && ' · '}
            {message.cached && 'Respuesta desde caché'}
          </p>
        )}
        {!isUser && !message.streaming && !message.id.startsWith('tmp-') && message.content && (
          <FeedbackButtons
            initialRating={message.feedback?.rating}
            initialComment={message.feedback?.comment}
            color={color}
            onRate={async (rating, comment) => {
              await api.rateMessage(message.id, rating, comment);
            }}
          />
        )}
        {!isUser && message.sources.length > 0 && !message.streaming && (
          <details className="mt-2 text-xs text-slate-600">
            <summary className="cursor-pointer select-none">Fuentes ({message.sources.length})</summary>
            <ol className="mt-2 space-y-2">
              {message.sources.map((s) => (
                <li key={s.index} className="rounded-md bg-white p-2">
                  <p className="font-medium">
                    {s.kind === 'web' && (
                      <span className="mr-1 rounded bg-amber-100 px-1 text-[10px] uppercase text-amber-800">web</span>
                    )}
                    [{s.index}] {s.documentName}
                    {s.page ? ` · página ${s.page}` : ''}
                  </p>
                  <p className="mt-1 text-slate-500">{s.snippet}</p>
                  {s.links && s.links.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-x-2">
                      {s.links.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                          {l.title}
                        </a>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}
