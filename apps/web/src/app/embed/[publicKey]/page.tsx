import { Suspense } from 'react';
import { WidgetChat } from '@/components/widget-chat';

/** Página que se carga dentro del iframe del widget. */
export default function EmbedPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-slate-400">Cargando…</div>}>
      <WidgetChat />
    </Suspense>
  );
}
