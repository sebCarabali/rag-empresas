'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Header } from '@/components/header';
import { Button, Card, ErrorText, Input, Spinner } from '@/components/ui';
import { api, type Company, type Project } from '@/lib/api';

const SELECTED_KEY = 'selectedCompanyId';

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export default function DashboardPage() {
  const [email, setEmail] = useState<string>();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(
      (me) => {
        setEmail(me.user.email);
        setCompanies(me.companies);
        const saved = readSelected();
        setCompanyId(me.companies.find((c) => c.id === saved)?.id ?? me.companies[0]?.id ?? null);
      },
      (e) => setError(e.message),
    );
  }, []);

  function selectCompany(id: string) {
    setCompanyId(id);
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* sin almacenamiento: se elige la primera empresa la próxima vez */
    }
  }

  const company = companies?.find((c) => c.id === companyId);

  return (
    <>
      <Header email={email}>
        {companies && companies.length > 1 && (
          <select
            className="rounded-md border border-slate-300 px-2 py-1"
            value={companyId ?? ''}
            onChange={(e) => selectCompany(e.target.value)}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {companies?.length === 1 && <span>{companies[0].name}</span>}
      </Header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <ErrorText>{error}</ErrorText>
        {!companies && !error && <Spinner />}
        {companies?.length === 0 && (
          <CreateCompany
            onCreated={(c) => {
              setCompanies([c]);
              selectCompany(c.id);
            }}
          />
        )}
        {company && <Projects key={company.id} company={company} />}
      </main>
    </>
  );
}

function CreateCompany({ onCreated }: { onCreated: (c: Company) => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      onCreated(await api.createCompany(name));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Registra tu empresa</h1>
          <p className="mt-1 text-sm text-slate-600">Serás el administrador. Luego podrás crear proyectos.</p>
        </div>
        <Input required minLength={2} placeholder="Nombre de la empresa" value={name} onChange={(e) => setName(e.target.value)} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Creando…' : 'Crear empresa'}
        </Button>
      </form>
    </Card>
  );
}

function Projects({ company }: { company: Company }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = company.role === 'owner' || company.role === 'admin';

  useEffect(() => {
    api.projects(company.id).then(setProjects, (e) => setError(e.message));
  }, [company.id]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const project = await api.createProject(company.id, name, description || undefined);
      setProjects((prev) => [project, ...(prev ?? [])]);
      setName('');
      setDescription('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{company.name}</h1>
        <p className="text-sm text-slate-500">
          Proyectos de la empresa · tu rol: {company.role}
          {canManage && (
            <>
              {' · '}
              <Link href={`/companies/${company.id}/settings`} className="font-medium text-slate-700 underline hover:text-slate-900">
                Configuración de la empresa
              </Link>
            </>
          )}
        </p>
      </div>

      {canManage && (
        <Card>
          <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row">
            <Input required minLength={2} placeholder="Nombre del proyecto" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Descripción (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Button type="submit" disabled={saving} className="shrink-0">
              {saving ? 'Creando…' : 'Nuevo proyecto'}
            </Button>
          </form>
        </Card>
      )}

      <ErrorText>{error}</ErrorText>
      {!projects && !error && <Spinner />}
      {projects?.length === 0 && <p className="text-sm text-slate-500">Todavía no hay proyectos.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-400"
          >
            <h2 className="font-semibold">{p.name}</h2>
            {p.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.description}</p>}
            <p className="mt-3 text-xs text-slate-400">Creado el {new Date(p.created_at).toLocaleDateString('es')}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
