'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Project } from '@/lib/api';
import { Brand, signOut } from './header';
import { BackIcon, BotIcon, ChartIcon, ChatIcon, CheckSquareIcon, LogoutIcon, MenuIcon } from './icons';

export interface ShellTab {
  id: string;
  label: string;
  href: string;
}

/**
 * Estructura de las pantallas de un proyecto: barra lateral oscura con la
 * navegación (en móvil, menú desplegable) y una cabecera con el título, las
 * acciones y, si hay, pestañas.
 */
export function ProjectShell({
  projectId,
  title,
  actions,
  tabs,
  activeTab,
  sidebarExtra,
  children,
}: {
  projectId: string;
  title?: ReactNode;
  actions?: ReactNode;
  tabs?: ShellTab[];
  activeTab?: string;
  sidebarExtra?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const usageTab = useSearchParams().get('tab') === 'uso';
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api.project(projectId).then(setProject, () => undefined);
    api.me().then((me) => setEmail(me.user.email ?? null), () => undefined);
  }, [projectId]);

  const base = `/projects/${projectId}`;
  const nav = [
    { href: base, label: 'Chat y documentos', icon: ChatIcon, active: pathname === base },
    { href: `${base}/chatbot`, label: 'Asistente y widget', icon: BotIcon, active: pathname === `${base}/chatbot` && !usageTab },
    { href: `${base}/chatbot?tab=uso`, label: 'Uso y gastos', icon: ChartIcon, active: pathname === `${base}/chatbot` && usageTab },
    { href: `${base}/quality`, label: 'Calidad', icon: CheckSquareIcon, active: pathname === `${base}/quality` },
  ];

  const navList = (
    <nav aria-label="Secciones del proyecto" className="flex flex-col gap-1">
      <span className="truncate px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[.08em] text-side-muted">
        {project?.name ?? 'Proyecto'}
      </span>
      {nav.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setMenuOpen(false)}
          aria-current={active ? 'page' : undefined}
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm transition ${
            active ? 'bg-side-hover text-white' : 'text-side-text hover:bg-side-hover hover:text-white'
          }`}
        >
          <Icon size={18} />
          {label}
        </Link>
      ))}
    </nav>
  );

  const account = (
    <div className="flex items-center gap-2.5 border-t border-side-line pt-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-side-hover text-xs font-semibold uppercase text-white">
        {email?.slice(0, 2) ?? '··'}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-side-text" title={email ?? undefined}>{email}</span>
      <button
        type="button"
        onClick={() => void signOut(router)}
        aria-label="Salir"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-side-text hover:bg-side-hover hover:text-white"
      >
        <LogoutIcon size={16} />
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-canvas md:flex-row">
      {/* Móvil: barra superior con menú */}
      <div className="flex items-center justify-between bg-side px-4 py-3 md:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="Menú"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-white hover:bg-side-hover"
        >
          <MenuIcon />
        </button>
      </div>
      {menuOpen && (
        <div className="flex flex-col gap-4 bg-side px-4 pb-4 md:hidden">
          {navList}
          {sidebarExtra}
          {account}
        </div>
      )}

      {/* Escritorio: barra lateral */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 overflow-y-auto bg-side px-4 py-5 md:flex">
        <div className="px-1.5">
          <Brand />
        </div>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-side-text hover:bg-side-hover hover:text-white"
        >
          <BackIcon size={16} />
          Todos los proyectos
        </Link>
        {navList}
        {sidebarExtra && <div className="min-h-0">{sidebarExtra}</div>}
        <div className="mt-auto">{account}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-line bg-white">
          <div className="flex flex-wrap items-center gap-3 px-6 pt-5 pb-4 md:px-8">
            <div className="mr-auto flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-muted">
                <Link href="/dashboard" className="hover:text-ink">Proyectos</Link> / {project?.name ?? '…'}
              </span>
              <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            </div>
            {actions}
          </div>
          {tabs && (
            <nav aria-label="Pestañas" className="flex gap-1 overflow-x-auto px-4 md:px-6">
              {tabs.map((t) => (
                <Link
                  key={t.id}
                  href={t.href}
                  aria-current={activeTab === t.id ? 'page' : undefined}
                  className={`-mb-px border-b-2 px-3 py-2.5 text-sm whitespace-nowrap ${
                    activeTab === t.id ? 'border-brand font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
          )}
        </header>
        <main className="flex min-h-0 flex-1 flex-col px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
