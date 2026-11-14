'use client';

import { useState } from 'react';
import { ThumbDownIcon, ThumbUpIcon } from './icons';

type Rating = -1 | 1;

/**
 * 👍/👎 con comentario opcional. La valoración se guarda al hacer clic; el
 * comentario se envía después (y reemplaza al anterior).
 */
export function FeedbackButtons({
  initialRating,
  initialComment,
  onRate,
  color = '#0f172a',
}: {
  initialRating?: Rating | null;
  initialComment?: string | null;
  onRate: (rating: Rating, comment?: string) => Promise<void>;
  color?: string;
}) {
  const [rating, setRating] = useState<Rating | null>(initialRating ?? null);
  const [comment, setComment] = useState(initialComment ?? '');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  async function rate(value: Rating) {
    const previous = rating;
    setRating(value);
    setError(false);
    setSaved(false);
    try {
      await onRate(value, comment || undefined);
      setEditing(true);
    } catch {
      setRating(previous);
      setError(true);
    }
  }

  async function sendComment() {
    if (!rating) return;
    try {
      await onRate(rating, comment.trim() || undefined);
      setEditing(false);
      setSaved(true);
    } catch {
      setError(true);
    }
  }

  const button = (value: Rating, label: string, Icon: typeof ThumbUpIcon) => (
    <button
      type="button"
      onClick={() => void rate(value)}
      aria-label={label}
      aria-pressed={rating === value}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
        rating === value ? 'border-transparent text-white' : 'border-line bg-white text-ink-2 hover:bg-canvas'
      }`}
      style={rating === value ? { background: color } : undefined}
    >
      <Icon size={15} />
    </button>
  );

  return (
    <div className="text-xs text-muted">
      <div className="flex items-center gap-1.5">
        {button(1, 'Respuesta útil', ThumbUpIcon)}
        {button(-1, 'Respuesta incorrecta o incompleta', ThumbDownIcon)}
        {saved && <span className="ml-1">¡Gracias!</span>}
        {error && <span className="ml-1 text-red-700">No se pudo guardar</span>}
      </div>
      {editing && (
        <div className="mt-2 flex gap-1.5">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void sendComment()}
            maxLength={1000}
            placeholder={rating === -1 ? '¿Qué estuvo mal o faltó? (opcional)' : 'Comentario (opcional)'}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-white px-2.5 text-[13px] text-ink-2 outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={() => void sendComment()}
            className="h-9 rounded-lg px-3 text-xs font-medium text-white"
            style={{ background: color }}
          >
            Enviar
          </button>
        </div>
      )}
    </div>
  );
}
