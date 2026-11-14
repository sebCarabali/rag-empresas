'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type CompanySettings } from '@/lib/api';
import { Header } from './header';
import { Button, Card, ErrorText, Input, Spinner } from './ui';

/** Ajustes de la empresa: por ahora, su propia clave de Gemini. */
export function CompanySettingsView() {
  const { companyId } = useParams<{ companyId: string }>();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api.me().then((me) => setCompanyName(me.companies.find((c) => c.id === companyId)?.name ?? ''), () => undefined);
    api.companySettings(companyId).then(setSettings, (e) => setError(e.message));
  }, [companyId, tick]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.setGeminiKey(companyId, key.trim());
      setKey('');
      setMessage('Clave verificada y guardada de forma cifrada.');
      setTick((t) => t + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('¿Eliminar la clave de la empresa? Se volverá a usar la clave de la plataforma.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteGeminiKey(companyId);
      setMessage('Clave eliminada.');
      setTick((t) => t + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const gemini = settings?.gemini;
  return (
    <>
      <Header>
        <Link href="/dashboard" className="hover:text-white">{companyName || 'Empresa'}</Link>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-white">Configuración de la empresa</span>
      </Header>
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-6 py-10">
        {!settings && !error && <Spinner />}
        <ErrorText>{error}</ErrorText>
        {settings && (
          <Card className="space-y-4">
            <div>
              <h2 className="font-semibold">Clave de Gemini de la empresa</h2>
              <p className="mt-1 text-sm text-muted">
                Con una clave propia, el chat y las descripciones web de tus proyectos usan tu cuenta de Google AI
                Studio (tu cuota y tu facturación). Sin clave se usa la de la plataforma.
              </p>
            </div>

            <div className="rounded-lg bg-canvas px-3 py-2 text-sm">
              {gemini?.configured ? (
                <>
                  <span className="font-medium text-emerald-700">Configurada</span> · termina en{' '}
                  <code className="rounded bg-white px-1">…{gemini.last4}</code>
                  {gemini.updatedAt && <> · actualizada el {new Date(gemini.updatedAt).toLocaleString('es')}</>}
                </>
              ) : (
                <span className="text-muted">Sin clave propia: se usa la de la plataforma.</span>
              )}
            </div>

            {settings.canEdit ? (
              <form onSubmit={save} className="space-y-3">
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={gemini?.configured ? 'Pega una clave nueva para reemplazarla' : 'Pega tu clave (AIza…)'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  minLength={20}
                  required
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={busy || key.trim().length < 20}>
                    {busy ? 'Verificando…' : gemini?.configured ? 'Reemplazar clave' : 'Guardar clave'}
                  </Button>
                  {gemini?.configured && (
                    <Button type="button" variant="danger" disabled={busy} onClick={() => void remove()}>
                      Eliminar
                    </Button>
                  )}
                  {message && <span className="text-sm text-emerald-700">{message}</span>}
                </div>
                <p className="text-xs text-muted">
                  La clave se comprueba con Gemini antes de guardarse y queda cifrada en Supabase Vault. Nunca se vuelve a
                  mostrar completa: solo sus últimos 4 caracteres. Créala en{' '}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline">
                    Google AI Studio
                  </a>
                  .
                </p>
              </form>
            ) : (
              <p className="text-sm text-muted">Solo owner o admin pueden cambiar la clave.</p>
            )}
          </Card>
        )}
      </main>
    </>
  );
}
