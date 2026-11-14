import { ChartIcon, ChatIcon, UploadIcon } from './icons';

const FEATURES = [
  {
    icon: UploadIcon,
    title: 'Sube PDF, Word, Excel, CSV o escaneos',
    text: 'Los catálogos se leen fila por fila para contar y filtrar con exactitud.',
  },
  {
    icon: ChatIcon,
    title: 'Pregunta en el chat o en tu sitio web',
    text: 'Un widget con tu marca, protegido con token.',
  },
  {
    icon: ChartIcon,
    title: 'Controla calidad y gastos',
    text: 'Valoraciones, pruebas automáticas y caché que ahorra llamadas.',
  },
];

/** Panel oscuro que explica el producto (ingreso e inicio). */
export function ProductPanel() {
  return (
    <section className="flex min-h-[420px] flex-1 basis-[480px] flex-col justify-center bg-side px-6 py-12 text-white sm:px-12 lg:px-20">
      <div className="flex max-w-lg flex-col gap-8">
        <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-[34px]">
          Un asistente que responde con los documentos de tu empresa.
        </h2>
        <ul className="flex flex-col gap-5">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-side-hover text-[#a5b4fc]">
                <Icon size={18} />
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-medium">{title}</span>
                <span className="text-sm text-[#a9b1bf]">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
