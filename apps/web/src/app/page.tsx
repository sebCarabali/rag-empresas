import Link from 'next/link';
import { LogoIcon } from '@/components/icons';
import { ProductPanel } from '@/components/product-panel';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-wrap bg-white">
      <section className="flex flex-1 basis-[480px] flex-col justify-center px-6 py-12 sm:px-12 lg:px-24">
        <div className="mx-auto flex w-full max-w-md flex-col gap-7">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand text-white">
              <LogoIcon size={20} />
            </span>
            <span className="text-[17px] font-semibold">RAG Empresas</span>
          </div>
          <div className="flex flex-col gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">Pregúntale a los documentos de tu empresa</h1>
            <p className="text-[17px] leading-relaxed text-muted">
              Organiza tus documentos por proyecto y consúltalos en un chat o en tu sitio web. Cada respuesta indica de qué
              documento sale.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex h-12 w-fit items-center rounded-[10px] bg-brand px-6 text-[15px] font-medium text-white hover:bg-brand-hover"
          >
            Empezar con tu correo
          </Link>
          <Link href="/docs/widget" className="text-sm font-medium text-brand hover:text-brand-hover">
            Guía: pon el asistente en tu sitio web →
          </Link>
        </div>
      </section>
      <ProductPanel />
    </main>
  );
}
