import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Pregúntale a los documentos de tu empresa</h1>
      <p className="text-lg text-slate-600">
        Organiza tus documentos por proyecto y consúltalos en un chat. Cada respuesta indica de qué documento sale.
      </p>
      <Link
        href="/login"
        className="rounded-lg bg-slate-900 px-6 py-3 text-sm font-medium text-white hover:bg-slate-700"
      >
        Empezar con tu email
      </Link>
    </main>
  );
}
