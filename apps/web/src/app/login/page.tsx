'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { LogoIcon } from '@/components/icons';
import { ProductPanel } from '@/components/product-panel';
import { Button, ErrorText, Input } from '@/components/ui';
import { getSupabase } from '@/lib/supabase/client';

/** Registro e inicio de sesión con enlace mágico: el mismo flujo sirve para ambos. */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get('error') ? 'El enlace no es válido o expiró. Pide uno nuevo.' : null,
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const next = searchParams.get('next') ?? '/dashboard';
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        shouldCreateUser: true,
      },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="flex min-h-screen flex-wrap bg-white">
      <section className="flex flex-1 basis-[480px] flex-col justify-center px-6 py-12 sm:px-12 lg:px-24">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-7">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand text-white">
              <LogoIcon size={20} />
            </span>
            <span className="text-[17px] font-semibold">RAG Empresas</span>
          </div>
          {sent ? (
            <div className="flex flex-col gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">Revisa tu correo</h1>
              <p className="text-[15px] leading-relaxed text-muted">
                Enviamos un enlace a <strong className="text-ink">{email}</strong>. Ábrelo en este navegador para entrar.
              </p>
              <button type="button" className="w-fit text-sm font-medium text-brand hover:text-brand-hover" onClick={() => setSent(false)}>
                Usar otro correo
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-semibold tracking-tight">Ingresa a tu cuenta</h1>
                <p className="text-[15px] text-muted">Te enviamos un enlace de acceso a tu correo. Sin contraseñas.</p>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="correo" className="text-sm font-medium">
                  Correo de trabajo
                </label>
                <Input
                  id="correo"
                  type="email"
                  required
                  autoFocus
                  placeholder="tu@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12"
                />
              </div>
              <ErrorText>{error}</ErrorText>
              <Button type="submit" disabled={loading} className="h-12 w-full text-[15px]">
                {loading ? 'Enviando…' : 'Enviar enlace de acceso'}
              </Button>
              <p className="text-[13px] text-muted">¿Tu empresa aún no está registrada? Ingresa con tu correo y créala en el primer paso.</p>
            </form>
          )}
        </div>
      </section>
      <ProductPanel />
    </main>
  );
}
