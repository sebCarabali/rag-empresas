'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type Chatbot } from '@/lib/api';
import { ChatPanel, ConversationList, useChat } from './chat-panel';
import { DocumentsPanel } from './documents-panel';
import { EnrichmentsPanel } from './enrichments-panel';
import { PlusIcon, TrashIcon } from './icons';
import { ProjectShell } from './project-shell';
import { Badge, Button, ErrorText } from './ui';

export function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const chat = useChat(projectId);
  const [bot, setBot] = useState<Chatbot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Personalización del asistente (si falla, el chat funciona con los valores por defecto).
    api.chatbot(projectId).then((r) => setBot(r.chatbot), () => undefined);
  }, [projectId]);

  async function remove() {
    const project = await api.project(projectId).catch(() => null);
    if (!project || !confirm(`¿Eliminar el proyecto "${project.name}" con todos sus documentos y chats?`)) return;
    try {
      await api.deleteProject(project.id);
      router.replace('/dashboard');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = chat.conversations.find((c) => c.id === chat.activeId);

  return (
    <ProjectShell
      projectId={projectId}
      title={active?.title ?? 'Chat y documentos'}
      sidebarExtra={<ConversationList chat={chat} />}
      actions={
        <>
          {bot?.widget_enabled && (
            <Badge tone="ok" dot>
              Widget activo
            </Badge>
          )}
          <Button variant="secondary" onClick={() => void chat.newConversation().catch((e) => chat.setError(e.message))}>
            <PlusIcon size={16} />
            Nueva conversación
          </Button>
          <Button variant="ghost" onClick={() => void remove()} aria-label="Eliminar proyecto" title="Eliminar proyecto">
            <TrashIcon size={16} />
          </Button>
        </>
      }
    >
      <ErrorText>{error}</ErrorText>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-h-[60vh] xl:min-h-0">
          <ChatPanel chat={chat} bot={bot} />
        </div>
        <div className="flex min-h-0 flex-col gap-4">
          <DocumentsPanel projectId={projectId} />
          <EnrichmentsPanel projectId={projectId} />
        </div>
      </div>
    </ProjectShell>
  );
}
