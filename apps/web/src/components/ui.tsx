'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles = {
    primary: 'bg-brand text-white hover:bg-brand-hover',
    secondary: 'bg-white text-ink border border-line-strong hover:bg-canvas',
    danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
    ghost: 'text-ink-2 hover:bg-canvas',
  }[variant];
  return (
    <button
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-11 w-full rounded-[10px] border border-line-strong bg-white px-3.5 text-[15px] text-ink outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/15 ${className}`}
      {...props}
    />
  );
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-[10px] border border-line-strong bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15 ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-white p-6 ${className}`}>{children}</div>;
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm break-words text-red-800">{children}</p>;
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-brand" aria-hidden="true" />
      {label}
    </p>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'brand' | 'danger';

export function Badge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  const styles = {
    neutral: 'bg-canvas text-ink-2',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    brand: 'bg-brand-soft text-brand-hover',
    danger: 'bg-red-50 text-red-700',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Encabezado de sección dentro de una tarjeta. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {aside}
    </div>
  );
}
