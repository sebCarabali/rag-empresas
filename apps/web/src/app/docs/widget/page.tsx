import type { Metadata } from 'next';
import { WidgetGuide } from '@/components/docs/widget-guide';

export const metadata: Metadata = {
  title: 'Guía del widget · RAG Empresas',
  description: 'Cómo poner el asistente de RAG Empresas en el sitio web de tu empresa: configuración, código para cada plataforma, modo protegido y solución de problemas.',
};

export default function WidgetDocsPage() {
  return <WidgetGuide />;
}
