'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { LogoIcon, LogoutIcon } from './icons';

export async function signOut(router: ReturnType<typeof useRouter>) {
  await getSupabase().auth.signOut();
  router.replace('/login');
  router.refresh();
}

/** Marca de la app (logo + nombre). */
export function Brand({ subtitle, dark = true }: { subtitle?: string; dark?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 rounded-lg">
      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-brand text-white">
        <LogoIcon size={18} />
      </span>
      <span className="flex flex-col leading-tight">
        <span className={`text-[15px] font-semibold ${dark ? 'text-white' : 'text-ink'}`}>RAG Empresas</span>
        {subtitle && <span className="text-xs text-side-muted">{subtitle}</span>}
      </span>
    </Link>
  );
}

/** Barra superior oscura de las páginas de empresa (proyectos, configuración). */
export function Header({ email, children }: { email?: string; children?: ReactNode }) {
  const router = useRouter();
  return (
    <header className="bg-side text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
        <Brand />
        <div className="flex flex-1 flex-wrap items-center gap-2 text-sm text-side-text">{children}</div>
        {email && <span className="hidden text-sm text-side-muted sm:inline">{email}</span>}
        <button
          type="button"
          onClick={() => void signOut(router)}
          className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-side-text hover:bg-side-hover hover:text-white"
        >
          <LogoutIcon size={16} />
          Salir
        </button>
      </div>
    </header>
  );
}
