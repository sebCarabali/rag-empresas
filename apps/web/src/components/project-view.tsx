'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChatPanel } from './chat-panel';
import { DocumentsPanel } from './documents-panel';
import { EnrichmentsPanel } from './enrichments-panel';
import { Header } from './header';
import { ErrorText, Spinner } from './ui';
import { api, type Project } from '@/lib/api';

export function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.project(projectId).then(setProject, (e) => setError(e.message));
  }, [projectId]);

  async function remove() {
    if (!project || !confirm(`¿Eliminar el proyecto "${project.name}" con todos sus documentos y chats?`)) return;
    try {
      await api.deleteProject(project.id);
      router.replace('/dashboard');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <Header>
        <Link href="/dashboard" className="hover:text-slate-900">
          Proyectos
        </Link>
        {project && (
          <>
            <span>/</span>
            <span className="font-medium text-slate-900">{project.name}</span>
            <button onClick={() => void remove()} className="ml-auto text-xs text-red-600 hover:text-red-800">
              Eliminar proyecto
            </button>
          </>
        )}
      </Header>

      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-6">
        <ErrorText>{error}</ErrorText>
        {!project && !error && <Spinner />}
        {project && (
          <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[320px_1fr]">
            <div className="flex min-h-0 flex-col gap-4">
              <div className="min-h-0 flex-1">
                <DocumentsPanel projectId={project.id} />
              </div>
              <EnrichmentsPanel projectId={project.id} />
            </div>
            <div className="min-h-[60vh] lg:min-h-0">
              <ChatPanel projectId={project.id} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
