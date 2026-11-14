/**
 * Ilustraciones de la guía del widget (SVG en línea, sin archivos externos).
 * Reproducen de forma simplificada las pantallas reales de la app.
 */

const INK = '#0e1116';
const MUTED = '#5b6472';
const LINE = '#e5e7eb';
const BRAND = '#4338ca';
const SOFT = '#eef0ff';
const SIDE = '#0e1116';

function Callout({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={11} fill={BRAND} stroke="#fff" strokeWidth={2} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
        {n}
      </text>
    </g>
  );
}

/** Cómo viaja una pregunta: sitio de la empresa → widget.js → chat (iframe) → API. */
export function FlowDiagram() {
  const box = (x: number, title: string, sub: string, dark = false) => (
    <g>
      <rect x={x} y={30} width={150} height={76} rx={14} fill={dark ? SIDE : '#fff'} stroke={dark ? SIDE : LINE} />
      <text x={x + 75} y={62} textAnchor="middle" fontSize={13} fontWeight={600} fill={dark ? '#fff' : INK}>
        {title}
      </text>
      <text x={x + 75} y={82} textAnchor="middle" fontSize={11} fill={dark ? '#c9ced8' : MUTED}>
        {sub}
      </text>
    </g>
  );
  const arrow = (x1: number, label: string) => (
    <g>
      <line x1={x1} y1={68} x2={x1 + 38} y2={68} stroke={BRAND} strokeWidth={2} markerEnd="url(#arr)" />
      <text x={x1 + 19} y={124} textAnchor="middle" fontSize={10} fill={MUTED}>
        {label}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 760 140" className="h-auto w-full" role="img" aria-label="Flujo: tu sitio carga widget.js, que abre el chat y consulta la API con tus documentos">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" fill={BRAND} />
        </marker>
      </defs>
      {box(0, 'Tu sitio web', '<script> de 1 línea')}
      {arrow(155, 'carga')}
      {box(198, 'widget.js', 'botón flotante')}
      {arrow(353, 'abre')}
      {box(396, 'Chat (iframe)', 'solo en tus dominios')}
      {arrow(551, 'pregunta')}
      {box(594, 'Asistente', 'tus documentos + IA', true)}
    </svg>
  );
}

/** Pantalla «Asistente y widget» con los campos que hay que revisar. */
export function SettingsMock() {
  const field = (y: number, label: string, value: string, h = 28) => (
    <g>
      <text x={196} y={y} fontSize={11} fontWeight={600} fill={INK}>
        {label}
      </text>
      <rect x={196} y={y + 6} width={300} height={h} rx={7} fill="#fff" stroke={LINE} />
      <text x={206} y={y + 24} fontSize={11} fill={MUTED}>
        {value}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 760 360" className="h-auto w-full" role="img" aria-label="Pantalla Asistente y widget con nombre, color, mensaje de bienvenida, dominios autorizados y activación del widget">
      <rect width={760} height={360} rx={16} fill="#f4f5f7" />
      <rect width={170} height={360} rx={16} fill={SIDE} />
      <rect x={150} width={20} height={360} fill={SIDE} />
      <rect x={18} y={22} width={22} height={22} rx={6} fill={BRAND} />
      <text x={48} y={38} fontSize={12} fontWeight={600} fill="#fff">
        RAG Empresas
      </text>
      {['Chat y documentos', 'Asistente y widget', 'Uso y gastos', 'Calidad'].map((t, i) => (
        <g key={t}>
          <rect x={12} y={70 + i * 34} width={146} height={28} rx={7} fill={i === 1 ? '#1c212b' : 'transparent'} />
          <text x={24} y={88 + i * 34} fontSize={11} fill={i === 1 ? '#fff' : '#8a93a3'}>
            {t}
          </text>
        </g>
      ))}
      <rect x={184} y={16} width={560} height={328} rx={14} fill="#fff" stroke={LINE} />
      <text x={196} y={44} fontSize={15} fontWeight={600} fill={INK}>
        Asistente y widget
      </text>
      {field(70, 'Nombre del asistente', 'Pat')}
      <text x={520} y={70} fontSize={11} fontWeight={600} fill={INK}>
        Color
      </text>
      <rect x={520} y={76} width={28} height={28} rx={7} fill={BRAND} />
      <text x={556} y={94} fontSize={11} fill={MUTED}>
        #4338ca
      </text>
      {field(122, 'Mensaje de bienvenida', '¡Hola! Soy Pat, ¿en qué te ayudo?')}
      {field(174, 'Dominios autorizados (uno por línea)', 'https://www.tuempresa.com', 40)}
      <rect x={196} y={238} width={16} height={16} rx={4} fill={BRAND} />
      <path d="M199 246l3 3 6-6" stroke="#fff" strokeWidth={2} fill="none" />
      <text x={220} y={250} fontSize={11} fill={INK}>
        Widget para tu sitio web · Activado
      </text>
      <text x={196} y={282} fontSize={11} fontWeight={600} fill={INK}>
        Código para insertar
      </text>
      <rect x={196} y={288} width={536} height={40} rx={8} fill={SIDE} />
      <text x={208} y={312} fontSize={10.5} fill="#e2e8f0" fontFamily="monospace">
        {'<script src="…/widget.js" data-bot="bot_3f9c…" async></script>'}
      </text>
      <Callout x={186} y={84} n={1} />
      <Callout x={510} y={84} n={2} />
      <Callout x={186} y={136} n={3} />
      <Callout x={186} y={188} n={4} />
      <Callout x={186} y={246} n={5} />
      <Callout x={186} y={308} n={6} />
    </svg>
  );
}

/** Página de una empresa con el botón del widget y el chat abierto. */
export function BrowserMock({ color = BRAND, side = 'right' as 'left' | 'right' }) {
  const bx = side === 'right' ? 680 : 30;
  const cx = side === 'right' ? 470 : 30;
  return (
    <svg viewBox="0 0 760 400" className="h-auto w-full" role="img" aria-label="Sitio web de ejemplo con el botón del chat en la esquina y la ventana del asistente abierta">
      <rect width={760} height={400} rx={14} fill="#fff" stroke={LINE} />
      <rect width={760} height={34} rx={14} fill="#f4f5f7" />
      <rect y={20} width={760} height={14} fill="#f4f5f7" />
      {[18, 34, 50].map((x, i) => (
        <circle key={x} cx={x} cy={17} r={5} fill={['#f87171', '#fbbf24', '#34d399'][i]} />
      ))}
      <rect x={80} y={8} width={360} height={18} rx={9} fill="#fff" stroke={LINE} />
      <text x={94} y={21} fontSize={10} fill={MUTED}>
        https://www.tuempresa.com
      </text>
      <rect x={40} y={60} width={220} height={18} rx={4} fill="#e5e7eb" />
      <rect x={40} y={92} width={360} height={10} rx={3} fill="#f1f2f4" />
      <rect x={40} y={110} width={320} height={10} rx={3} fill="#f1f2f4" />
      <rect x={40} y={140} width={180} height={120} rx={10} fill="#f4f5f7" />
      <rect x={236} y={140} width={180} height={120} rx={10} fill="#f4f5f7" />
      <g>
        <rect x={cx} y={70} width={260} height={252} rx={18} fill="#fff" stroke={LINE} />
        <rect x={cx} y={70} width={260} height={48} rx={18} fill={color} />
        <rect x={cx} y={100} width={260} height={18} fill={color} />
        <text x={cx + 16} y={99} fontSize={13} fontWeight={600} fill="#fff">
          Pat
        </text>
        <rect x={cx + 14} y={132} width={190} height={34} rx={12} fill="#f4f5f7" />
        <text x={cx + 24} y={153} fontSize={10.5} fill={INK}>
          ¡Hola! ¿En qué te ayudo?
        </text>
        <rect x={cx + 70} y={178} width={176} height={30} rx={12} fill={color} />
        <text x={cx + 80} y={197} fontSize={10.5} fill="#fff">
          ¿Tienen telas de lino?
        </text>
        <rect x={cx + 14} y={220} width={210} height={46} rx={12} fill="#f4f5f7" />
        <text x={cx + 24} y={240} fontSize={10.5} fill={INK}>
          Sí, tenemos 4 telas de lino…
        </text>
        <text x={cx + 24} y={256} fontSize={9.5} fill={MUTED}>
          Fuente: catálogo.xlsx
        </text>
        <rect x={cx + 14} y={282} width={232} height={28} rx={9} fill="#fff" stroke={LINE} />
        <text x={cx + 24} y={300} fontSize={10} fill={MUTED}>
          Escribe tu pregunta…
        </text>
      </g>
      <rect x={bx} y={334} width={50} height={50} rx={16} fill={color} />
      <g transform={`translate(${bx + 13} 347)`} stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18M6 6l12 12" />
      </g>
    </svg>
  );
}

/** Público frente a protegido: quién puede abrir el chat. */
export function ModesDiagram({ mode }: { mode: 'public' | 'token' }) {
  const on = mode === 'token';
  return (
    <svg viewBox="0 0 760 190" className="h-auto w-full" role="img" aria-label={on ? 'Modo protegido: tu servidor pide un token con la clave secreta y se lo entrega al widget' : 'Modo público: el navegador del visitante abre el chat directamente'}>
      <rect x={0} y={50} width={160} height={84} rx={14} fill="#fff" stroke={LINE} />
      <text x={80} y={86} textAnchor="middle" fontSize={13} fontWeight={600} fill={INK}>
        Navegador
      </text>
      <text x={80} y={106} textAnchor="middle" fontSize={11} fill={MUTED}>
        visitante de tu sitio
      </text>

      <rect x={300} y={0} width={160} height={84} rx={14} fill={on ? SOFT : '#f9fafb'} stroke={on ? BRAND : LINE} strokeDasharray={on ? undefined : '5 4'} opacity={on ? 1 : 0.5} />
      <text x={380} y={36} textAnchor="middle" fontSize={13} fontWeight={600} fill={INK}>
        Tu servidor
      </text>
      <text x={380} y={56} textAnchor="middle" fontSize={11} fill={MUTED}>
        {on ? 'guarda la clave sk_live_' : 'no hace falta'}
      </text>

      <rect x={600} y={50} width={160} height={84} rx={14} fill={SIDE} />
      <text x={680} y={86} textAnchor="middle" fontSize={13} fontWeight={600} fill="#fff">
        Asistente
      </text>
      <text x={680} y={106} textAnchor="middle" fontSize={11} fill="#c9ced8">
        API de RAG Empresas
      </text>

      <defs>
        <marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" fill={BRAND} />
        </marker>
      </defs>
      {on ? (
        <>
          <path d="M160 70 C220 40 250 40 298 40" stroke={BRAND} strokeWidth={2} fill="none" markerEnd="url(#arr2)" />
          <text x={218} y={30} fontSize={10} fill={MUTED} textAnchor="middle">
            1. GET /chat-token
          </text>
          <path d="M460 40 C520 40 560 60 598 74" stroke={BRAND} strokeWidth={2} fill="none" markerEnd="url(#arr2)" />
          <text x={540} y={30} fontSize={10} fill={MUTED} textAnchor="middle">
            2. POST /v1/widget-tokens
          </text>
          <path d="M600 118 C450 180 300 180 162 118" stroke={BRAND} strokeWidth={2} fill="none" markerEnd="url(#arr2)" strokeDasharray="6 4" />
          <text x={380} y={176} fontSize={10} fill={MUTED} textAnchor="middle">
            3. el chat funciona con el token temporal (wt1…), que vence y se renueva solo
          </text>
        </>
      ) : (
        <>
          <line x1={162} y1={92} x2={596} y2={92} stroke={BRAND} strokeWidth={2} markerEnd="url(#arr2)" />
          <text x={380} y={160} fontSize={10.5} fill={MUTED} textAnchor="middle">
            Solo con la clave pública bot_… y desde los dominios autorizados
          </text>
        </>
      )}
    </svg>
  );
}
