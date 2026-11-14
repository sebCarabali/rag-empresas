'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSupabase } from '@/lib/supabase/client';

export function Header({ email, children }: { email?: string; children?: ReactNode }) {
  const router = useRouter();

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
        <Link href="/dashboard" className="font-semibold">
          Documentos IA
        </Link>
        <div className="flex flex-1 items-center gap-2 text-sm text-slate-600">{children}</div>
        {email && <span className="hidden text-sm text-slate-500 sm:inline">{email}</span>}
        <button onClick={signOut} className="text-sm text-slate-600 hover:text-slate-900">
          Salir
        </button>
      </div>
    </header>
  );
}
