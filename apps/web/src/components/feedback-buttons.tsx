'use client';

import { useState } from 'react';

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

  const button = (value: Rating, label: string, icon: string) => (
    <button
      type="button"
      onClick={() => void rate(value)}
      aria-label={label}
      aria-pressed={rating === value}
      title={label}
      className={`rounded px-1.5 py-0.5 text-sm transition ${rating === value ? 'bg-white shadow-sm' : 'opacity-50 hover:opacity-100'}`}
      style={rating === value ? { outline: `1px solid ${color}` } : undefined}
    >
      {icon}
    </button>
  );

  return (
    <div className="mt-2 text-xs text-slate-500">
      <div className="flex items-center gap-1">
        {button(1, 'Respuesta útil', '👍')}
        {button(-1, 'Respuesta incorrecta o incompleta', '👎')}
        {saved && <span className="ml-1">¡Gracias!</span>}
        {error && <span className="ml-1 text-red-600">No se pudo guardar</span>}
      </div>
      {editing && (
        <div className="mt-1 flex gap-1">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void sendComment()}
            maxLength={1000}
            placeholder={rating === -1 ? '¿Qué estuvo mal o faltó? (opcional)' : 'Comentario (opcional)'}
            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-slate-500"
          />
          <button
            type="button"
            onClick={() => void sendComment()}
            className="rounded px-2 py-1 text-xs text-white"
            style={{ background: color }}
          >
            Enviar
          </button>
        </div>
      )}
    </div>
  );
}
