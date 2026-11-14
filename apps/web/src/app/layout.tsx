import type { Metadata } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import './globals.css';

export const metadata: Metadata = {
  title: 'RAG Empresas',
  description: 'Un asistente que responde con los documentos de tu empresa',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" className={`h-full antialiased ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
