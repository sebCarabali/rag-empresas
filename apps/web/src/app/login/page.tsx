'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Button, Card, ErrorText, Input } from '@/components/ui';
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
    <main className="flex flex-1 items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        {sent ? (
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold">Revisa tu correo</h1>
            <p className="text-sm text-slate-600">
              Enviamos un enlace a <strong>{email}</strong>. Ábrelo en este navegador para entrar.
            </p>
            <button className="text-sm text-slate-500 underline" onClick={() => setSent(false)}>
              Usar otro email
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Entrar o registrarse</h1>
              <p className="mt-1 text-sm text-slate-600">Te enviamos un enlace de acceso, sin contraseña.</p>
            </div>
            <Input
              type="email"
              required
              autoFocus
              placeholder="tu@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <ErrorText>{error}</ErrorText>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Enviando…' : 'Enviar enlace'}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
