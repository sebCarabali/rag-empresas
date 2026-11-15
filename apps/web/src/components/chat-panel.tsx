'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  api,
  modelLabel,
  type CacheMatch,
  type Chatbot,
  type Conversation,
  type Feedback,
  type Message,
  type ModelInfo,
  type Source,
  type ToolCall,
} from '@/lib/api';
import { FeedbackButtons } from './feedback-buttons';
import { SendIcon, TrashIcon } from './icons';
import { ErrorText } from './ui';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  toolCalls?: ToolCall[];
  modelInfo?: ModelInfo | null;
  cached?: boolean;
  cacheMatch?: CacheMatch | null;
  streaming?: boolean;
  feedback?: Feedback | null;
}

/** Estado del chat del proyecto: conversaciones, mensajes y envío en streaming. */
export function useChat(projectId: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tempId = useRef(0);

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

  useEffect(() => () => abortRef.current?.abort(), []);

  function select(id: string) {
    setActiveId(id);
  }

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

  async function send(question: string) {
    if (!question.trim() || sending) return;
    setError(null);
    setSending(true);
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
          onDone: ({ messageId, title, cached, cacheMatch }) => {
            update((msg) => ({ ...msg, id: messageId, streaming: false, cached, cacheMatch }));
            setConversations((list) => list.map((c) => (c.id === conversationId ? { ...c, title } : c)));
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

  return {
    conversations,
    activeId,
    messages,
    sending,
    error,
    select,
    newConversation,
    removeConversation,
    send,
    stop: () => abortRef.current?.abort(),
    setError,
  };
}

export type ChatState = ReturnType<typeof useChat>;

/** Historial de conversaciones (va en la barra lateral oscura). */
export function ConversationList({ chat }: { chat: ChatState }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[.08em] text-side-muted">Conversaciones</span>
      {chat.conversations.length === 0 && <p className="px-2.5 text-xs text-side-muted">Aún no hay conversaciones.</p>}
      <ul className="flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto">
        {chat.conversations.map((c) => (
          <li key={c.id} className="group flex items-center">
            <button
              type="button"
              onClick={() => chat.select(c.id)}
              aria-current={c.id === chat.activeId ? 'true' : undefined}
              title={c.title}
              className={`min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                c.id === chat.activeId ? 'bg-side-hover text-white' : 'text-side-text hover:bg-side-hover hover:text-white'
              }`}
            >
              {c.title}
            </button>
            <button
              type="button"
              onClick={() => void chat.removeConversation(c.id)}
              aria-label={`Eliminar «${c.title}»`}
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-side-muted opacity-0 hover:bg-side-hover hover:text-white focus:opacity-100 group-hover:opacity-100"
            >
              <TrashIcon size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChatPanel({ chat, bot }: { chat: ChatState; bot?: Chatbot | null }) {
  const color = bot?.primary_color ?? '#4338ca';
  const botName = bot?.name ?? 'Asistente';
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Desplaza solo la lista de mensajes (no la página) hasta el último.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chat.messages]);

  function submit(e?: FormEvent, text?: string) {
    e?.preventDefault();
    const question = (text ?? input).trim();
    if (!question) return;
    setInput('');
    void chat.send(question);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <section className="flex h-full min-h-[560px] flex-col rounded-2xl border border-line bg-white">
      <div ref={scrollRef} className="max-h-[calc(100vh-15rem)] min-h-0 flex-1 space-y-6 overflow-y-auto p-5 md:p-7">
        {chat.messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
            {bot?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bot.avatar_url} alt="" className="h-14 w-14 rounded-2xl object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-semibold text-white" style={{ background: color }}>
                {botName.charAt(0).toUpperCase()}
              </div>
            )}
            <p className="text-lg font-semibold">{botName}</p>
            <p className="max-w-md text-[15px] text-muted">{bot?.welcome_message || 'Haz una pregunta sobre los documentos de este proyecto.'}</p>
            {(bot?.suggested_questions.length ?? 0) > 0 && (
              <div className="mt-2 flex max-w-xl flex-wrap justify-center gap-2">
                {bot!.suggested_questions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => submit(undefined, q)}
                    className="h-9 rounded-full border border-line-strong bg-white px-3.5 text-[13px] text-ink-2 hover:border-brand hover:bg-brand-soft"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {chat.messages.map((m) => (
          <MessageBubble key={m.id} message={m} color={color} botName={botName} />
        ))}
      </div>
      {chat.error && (
        <div className="px-5">
          <ErrorText>{chat.error}</ErrorText>
        </div>
      )}
      <form onSubmit={submit} className="flex items-end gap-2.5 border-t border-line p-4">
        <label htmlFor="pregunta" className="sr-only">
          Tu pregunta
        </label>
        <textarea
          id="pregunta"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={4000}
          placeholder="Pregunta sobre tus documentos…  (Enter para enviar, Shift+Enter para salto de línea)"
          className="flex-1 resize-none rounded-xl border border-line-strong bg-[#fbfbfc] px-3.5 py-3 text-[15px] outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
        />
        {chat.sending ? (
          <button
            type="button"
            onClick={chat.stop}
            className="h-12 rounded-xl border border-line-strong bg-white px-4 text-sm font-medium hover:bg-canvas"
          >
            Detener
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Enviar"
            className="flex h-12 w-12 items-center justify-center rounded-xl text-white transition disabled:opacity-40"
            style={{ background: color }}
          >
            <SendIcon size={20} />
          </button>
        )}
      </form>
    </section>
  );
}

function MessageBubble({ message, color, botName }: { message: ChatMessage; color: string; botName: string }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md px-4 py-3 text-[15px] leading-relaxed text-white"
          style={{ background: color }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  const info = message.modelInfo;
  return (
    <div className="flex max-w-[92%] gap-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-sm font-semibold"
        style={{ color }}
        aria-hidden="true"
      >
        {botName.charAt(0).toUpperCase()}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {(message.toolCalls?.length ?? 0) > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {message.toolCalls!.map((call, i) => (
              <li key={i} className="rounded-md border border-line bg-canvas px-2 py-1 font-mono text-xs break-words text-ink-2">
                {call.summary}
                {call.error ? (
                  <span className="text-red-700"> · error</span>
                ) : (
                  call.total !== null && <span> · {call.total.toLocaleString('es')} resultados</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">
          {message.content}
          {message.streaming && !message.content && <span className="animate-pulse text-muted">Buscando en los documentos…</span>}
          {message.streaming && message.content && <span className="animate-pulse">▍</span>}
        </div>
        {info?.fallback && (
          <p className="rounded-lg bg-warn-soft px-3 py-1.5 text-xs text-warn">
            Respondido con el modelo de respaldo <strong>Groq · {info.model}</strong>
            {info.reason ? ` porque ${info.reason}.` : '.'}
          </p>
        )}
        {!message.streaming && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {!message.id.startsWith('tmp-') && message.content && (
              <FeedbackButtons
                initialRating={message.feedback?.rating}
                initialComment={message.feedback?.comment}
                color={color}
                onRate={async (rating, comment) => {
                  await api.rateMessage(message.id, rating, comment);
                }}
              />
            )}
            {(info || message.cached) && (
              <span>
                {info &&
                  `${modelLabel(info)}${info.fallback ? ' (respaldo)' : ''}${info.keyOwner === 'company' ? ' · clave de la empresa' : ''}`}
                {info && message.cached && ' · '}
                {message.cached &&
                  (message.cacheMatch?.kind === 'semantic'
                    ? `desde caché · pregunta parecida: «${message.cacheMatch.question}»`
                    : 'desde caché')}
              </span>
            )}
          </div>
        )}
        {message.sources.length > 0 && !message.streaming && (
          <details className="text-xs text-ink-2">
            <summary className="w-fit cursor-pointer select-none font-medium text-brand hover:text-brand-hover">
              Fuentes ({message.sources.length})
            </summary>
            <ol className="mt-2 grid gap-2">
              {message.sources.map((s) => (
                <li key={s.index} className="rounded-xl border border-line bg-canvas/60 p-3">
                  <p className="font-medium">
                    {s.kind === 'web' && (
                      <span className="mr-1.5 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warn">web</span>
                    )}
                    [{s.index}] {s.documentName}
                    {s.page ? ` · página ${s.page}` : ''}
                  </p>
                  <p className="mt-1 text-muted">{s.snippet}</p>
                  {s.links && s.links.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap gap-x-3">
                      {s.links.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="text-brand underline">
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
