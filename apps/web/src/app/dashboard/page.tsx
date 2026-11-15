'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Header } from '@/components/header';
import { FileIcon, PlusIcon } from '@/components/icons';
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
            aria-label="Empresa"
            className="h-9 rounded-lg border border-side-line bg-side-hover px-2.5 text-sm text-white"
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
        {companies?.length === 1 && <span className="rounded-lg bg-side-hover px-2.5 py-1.5 text-sm text-white">{companies[0].name}</span>}
      </Header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
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
          <h1 className="text-2xl font-semibold tracking-tight">Registra tu empresa</h1>
          <p className="mt-1 text-sm text-muted">Serás el administrador. Luego podrás crear proyectos.</p>
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
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto flex flex-col gap-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Proyectos</h1>
          <p className="text-[15px] text-muted">
            {company.name} · cada proyecto tiene sus documentos, su asistente y su widget · tu rol: {company.role}
          </p>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>
      {!projects && !error && <Spinner />}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p, i) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="group flex flex-col gap-4 rounded-2xl border border-line bg-white p-5 transition hover:border-[#a5b4fc] hover:shadow-[0_6px_24px_rgba(14,17,22,.06)]"
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                  i % 2 === 0 ? 'bg-brand-soft text-brand' : 'bg-[#e6f4f1] text-[#0f766e]'
                }`}
              >
                <FileIcon size={22} />
              </span>
              <div className="flex min-w-0 flex-col">
                <h2 className="truncate text-[17px] font-semibold group-hover:text-brand">{p.name}</h2>
                <span className="text-xs text-muted">Creado el {new Date(p.created_at).toLocaleDateString('es')}</span>
              </div>
            </div>
            <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted">{p.description || 'Sin descripción.'}</p>
          </Link>
        ))}

        {canManage && (
          <form
            onSubmit={create}
            className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-dashed border-line-strong bg-white/50 p-5"
          >
            <span className="flex items-center gap-2 text-[15px] font-semibold">
              <PlusIcon size={18} />
              Nuevo proyecto
            </span>
            <label htmlFor="p-nombre" className="sr-only">Nombre del proyecto</label>
            <Input id="p-nombre" required minLength={2} placeholder="Nombre del proyecto" value={name} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="p-desc" className="sr-only">Descripción</label>
            <Input id="p-desc" placeholder="Descripción (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Button type="submit" disabled={saving}>
              {saving ? 'Creando…' : 'Crear proyecto'}
            </Button>
          </form>
        )}
      </div>
      {projects?.length === 0 && !canManage && <p className="text-sm text-muted">Todavía no hay proyectos.</p>}
    </div>
  );
}
