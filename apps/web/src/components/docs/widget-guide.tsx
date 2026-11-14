'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BotIcon, ChatIcon, CheckSquareIcon, CloseIcon, LogoIcon, SendIcon, SettingsIcon } from '../icons';
import { BrowserMock, FlowDiagram, ModesDiagram, SettingsMock } from './illustrations';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const FALLBACK_ORIGIN = 'https://rag-empresas-web.vercel.app';
const KEY_RE = /^bot_[0-9a-f]{32}$/;

const noop = () => () => {};
function useOrigin(): string {
  return useSyncExternalStore(noop, () => window.location.origin, () => FALLBACK_ORIGIN);
}
/** Clave que llega en ?bot= (enlace desde la configuración del asistente). */
function useKeyFromUrl(): string {
  return useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).get('bot') ?? '',
    () => '',
  );
}

const SECTIONS = [
  ['resumen', 'Cómo funciona'],
  ['configurar', '1. Configura el asistente'],
  ['modo', '2. Público o protegido'],
  ['codigo', '3. Genera el código'],
  ['servidor', '4. Token en tu servidor'],
  ['probar', '5. Prueba el widget'],
  ['verificar', 'Lista de verificación'],
  ['problemas', 'Solución de problemas'],
  ['referencia', 'Referencia'],
] as const;

/* ------------------------------------------------------------------ */
/* Piezas comunes                                                       */
/* ------------------------------------------------------------------ */

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="overflow-hidden rounded-xl bg-side">
      <div className="flex items-center justify-between border-b border-side-line px-4 py-2 text-xs text-side-muted">
        <span>{label ?? 'Código'}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
          }}
          className="rounded-md px-2 py-1 font-medium text-side-text hover:bg-side-hover"
        >
          {copied ? '¡Copiado!' : 'Copiar'}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap p-4 text-[12.5px] leading-relaxed text-slate-100 [overflow-wrap:anywhere]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 rounded-xl bg-canvas p-1">
      {tabs.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`rounded-lg px-3 py-1.5 text-sm transition ${
            value === id ? 'bg-white font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-10 first:border-0 first:pt-0">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      {intro && <p className="mt-2 max-w-2xl leading-relaxed text-muted">{intro}</p>}
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Note({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${
        tone === 'warn' ? 'border-amber-200 bg-warn-soft text-[#6b3d00]' : 'border-[#dfe2ff] bg-brand-soft text-ink-2'
      }`}
    >
      {children}
    </div>
  );
}

/** scroll: en pantallas angostas el diagrama no se encoge (texto legible) y se desplaza de lado. */
function Figure({ children, caption, scroll }: { children: ReactNode; caption: string; scroll?: boolean }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-white p-3 sm:p-5">
      {scroll ? (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">{children}</div>
        </div>
      ) : (
        children
      )}
      <figcaption className="mt-3 text-center text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Paso 1: campos de la configuración                                    */
/* ------------------------------------------------------------------ */

const FIELDS = [
  ['Nombre del asistente', 'Aparece en la cabecera del chat y en el botón. Ej.: «Pat».'],
  ['Color', 'Color del botón flotante, la cabecera y tus mensajes. Usa el de tu marca.'],
  ['Mensaje de bienvenida', 'Lo primero que ve el visitante. Corto y con una invitación a preguntar.'],
  ['Dominios autorizados', 'Sitios donde se permite mostrar el chat, con https:// y tal como aparecen en el navegador (con o sin www). Máximo 10.'],
  ['Widget para tu sitio web → Activado', 'Mientras esté apagado, el chat no se abre en ningún sitio.'],
  ['Código para insertar', 'La línea <script> con la clave pública de tu asistente (bot_…). Cópiala en el paso 3.'],
] as const;

function FieldsExplorer() {
  const [active, setActive] = useState(0);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Figure caption="Proyecto → Asistente y widget. Pulsa un número para ver qué hace cada campo.">
        <SettingsMock />
      </Figure>
      <ol className="flex flex-col gap-2">
        {FIELDS.map(([title, text], i) => (
          <li key={title}>
            <button
              type="button"
              onClick={() => setActive(i)}
              aria-expanded={active === i}
              className={`w-full rounded-xl border p-3 text-left transition ${
                active === i ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-line-strong'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                {title}
              </span>
              {active === i && <span className="mt-1.5 block text-[13px] leading-relaxed text-muted">{text}</span>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paso 2: modos                                                         */
/* ------------------------------------------------------------------ */

type Mode = 'public' | 'token';

function ModePicker({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const cards: Array<{ id: Mode; title: string; best: string; points: string[] }> = [
    {
      id: 'public',
      title: 'Público',
      best: 'Sitios informativos, tiendas, preguntas frecuentes.',
      points: ['Solo pegas una línea de código', 'Funciona en cualquier plataforma (WordPress, Shopify…)', 'Protegido por dominios autorizados y límite diario'],
    },
    {
      id: 'token',
      title: 'Protegido (con token)',
      best: 'Portales de clientes, intranets, información sensible.',
      points: ['Tu servidor emite un token temporal con tu clave secreta', 'Nadie puede usar el chat fuera de tu sitio', 'Puedes limitarlo a usuarios con sesión iniciada'],
    },
  ];
  return (
    <>
      <div role="radiogroup" aria-label="Modo del widget" className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={mode === c.id}
            onClick={() => setMode(c.id)}
            className={`rounded-2xl border p-5 text-left transition ${
              mode === c.id ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line bg-white hover:border-line-strong'
            }`}
          >
            <span className="flex items-center justify-between">
              <span className="text-base font-semibold">{c.title}</span>
              <span
                className={`h-4 w-4 rounded-full border-2 ${mode === c.id ? 'border-brand bg-brand shadow-[inset_0_0_0_3px_#eef0ff]' : 'border-line-strong'}`}
              />
            </span>
            <span className="mt-1 block text-[13px] text-muted">{c.best}</span>
            <ul className="mt-3 space-y-1.5 text-[13px] text-ink-2">
              {c.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="mt-[3px] text-brand">
                    <CheckSquareIcon size={13} />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
      <Figure scroll caption={mode === 'token' ? 'Modo protegido: la clave secreta nunca sale de tu servidor.' : 'Modo público: el navegador abre el chat directamente.'}>
        <ModesDiagram mode={mode} />
      </Figure>
      <p className="text-sm text-muted">
        El modo se elige en <strong className="text-ink-2">Asistente y widget → Acceso al widget</strong>. Las claves secretas se crean en la pestaña{' '}
        <strong className="text-ink-2">Claves de API</strong> (solo propietarios y administradores).
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Paso 3: generador de código                                           */
/* ------------------------------------------------------------------ */

type Platform = 'html' | 'wordpress' | 'shopify' | 'gtm' | 'next';
type TokenSource = 'url' | 'fixed';

const PLATFORMS: ReadonlyArray<readonly [Platform, string]> = [
  ['html', 'HTML'],
  ['wordpress', 'WordPress'],
  ['shopify', 'Shopify'],
  ['gtm', 'Google Tag Manager'],
  ['next', 'React / Next.js'],
];

const WHERE: Record<Platform, ReactNode> = {
  html: (
    <>
      Pega el código justo antes de <code>&lt;/body&gt;</code> en todas las páginas donde quieras el chat (normalmente en la plantilla común o el
      pie de página).
    </>
  ),
  wordpress: (
    <>
      Instala el plugin gratuito <strong>WPCode</strong> → <em>Code Snippets → Header &amp; Footer</em> → pega el código en <strong>Footer</strong> y guarda.
      Así no se pierde al actualizar el tema.
    </>
  ),
  shopify: (
    <>
      En el admin: <em>Tienda online → Temas → ⋯ → Editar código</em>, abre <code>layout/theme.liquid</code> y pega el código antes de{' '}
      <code>&lt;/body&gt;</code>.
    </>
  ),
  gtm: (
    <>
      Crea una etiqueta <strong>HTML personalizado</strong> con el código, activador <strong>All Pages</strong>, y publica el contenedor.
    </>
  ),
  next: (
    <>
      Agrega el componente en el layout raíz (<code>app/layout.tsx</code>). <code>next/script</code> lo carga después de que la página es
      interactiva.
    </>
  ),
};

function scriptTag(origin: string, key: string, side: 'left' | 'right', mode: Mode, source: TokenSource, tokenUrl: string) {
  const attrs = [`src="${origin}/widget.js"`, `data-bot="${key}"`];
  if (side === 'left') attrs.push('data-position="left"');
  if (mode === 'token') attrs.push(source === 'url' ? `data-token-url="${tokenUrl}"` : 'data-token="{{TOKEN_GENERADO_EN_TU_SERVIDOR}}"');
  return { attrs, html: `<script ${attrs.join(' ')} async></script>` };
}

function platformCode(platform: Platform, origin: string, key: string, side: 'left' | 'right', mode: Mode, source: TokenSource, tokenUrl: string) {
  const { attrs, html } = scriptTag(origin, key, side, mode, source, tokenUrl);
  switch (platform) {
    case 'html':
      return `<!-- Asistente de RAG Empresas -->\n${html}\n</body>`;
    case 'wordpress':
    case 'gtm':
      return `<!-- Asistente de RAG Empresas -->\n${html}`;
    case 'shopify':
      return `{% comment %} Asistente de RAG Empresas {% endcomment %}\n${html}\n</body>`;
    case 'next': {
      const props = attrs
        .map((a) => a.replace(/^data-token="\{\{TOKEN_GENERADO_EN_TU_SERVIDOR\}\}"$/, 'data-token={chatToken}'))
        .map((a) => `        ${a}`)
        .join('\n');
      return `import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <Script
${props}
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`;
    }
  }
}

function SnippetBuilder({
  origin,
  keyValue,
  setKey,
  mode,
  side,
  setSide,
}: {
  origin: string;
  keyValue: string;
  setKey: (v: string) => void;
  mode: Mode;
  side: 'left' | 'right';
  setSide: (v: 'left' | 'right') => void;
}) {
  const [platform, setPlatform] = useState<Platform>('html');
  const [source, setSource] = useState<TokenSource>('url');
  const [tokenUrl, setTokenUrl] = useState('/chat-token');
  const key = keyValue.trim();
  const valid = KEY_RE.test(key);
  const shownKey = key || 'bot_TU_CLAVE_PUBLICA';
  const code = platformCode(platform, origin, shownKey, side, mode, source, tokenUrl.trim() || '/chat-token');

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-5">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Clave pública del asistente</span>
          <input
            value={keyValue}
            onChange={(e) => setKey(e.target.value)}
            placeholder="bot_3f9c…"
            spellCheck={false}
            className="h-10 w-full rounded-[9px] border border-line-strong px-3 font-mono text-[13px] outline-none focus:border-brand"
          />
          <span className={`block text-xs ${key && !valid ? 'text-red-700' : 'text-muted'}`}>
            {key && !valid ? 'Debe ser «bot_» seguido de 32 caracteres (0-9, a-f).' : 'Está en Asistente y widget → Código para insertar.'}
          </span>
        </label>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Posición del botón</legend>
          <div className="flex gap-2">
            {(['right', 'left'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                aria-pressed={side === s}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm ${side === s ? 'border-brand bg-brand-soft font-medium' : 'border-line'}`}
              >
                {s === 'right' ? 'Derecha' : 'Izquierda'}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="rounded-xl bg-canvas p-3 text-sm">
          Modo: <strong>{mode === 'token' ? 'Protegido' : 'Público'}</strong>{' '}
          <a href="#modo" className="text-brand hover:text-brand-hover">
            cambiar
          </a>
        </div>

        {mode === 'token' && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">¿Cómo recibe el token el widget?</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="src" checked={source === 'url'} onChange={() => setSource('url')} className="mt-1" />
              <span>
                <strong>Desde una URL de tu sitio</strong> <span className="text-muted">(recomendado: se renueva solo al vencer)</span>
              </span>
            </label>
            {source === 'url' && (
              <input
                value={tokenUrl}
                onChange={(e) => setTokenUrl(e.target.value)}
                className="ml-6 h-9 w-[calc(100%-1.5rem)] rounded-[9px] border border-line-strong px-3 font-mono text-[13px] outline-none focus:border-brand"
                aria-label="URL del token"
              />
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="src" checked={source === 'fixed'} onChange={() => setSource('fixed')} className="mt-1" />
              <span>
                <strong>Escrito al generar la página</strong> <span className="text-muted">(plantillas Razor, Thymeleaf, JSP…)</span>
              </span>
            </label>
          </fieldset>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <Tabs tabs={PLATFORMS} value={platform} onChange={setPlatform} label="Plataforma" />
        <p className="text-sm leading-relaxed text-ink-2">{WHERE[platform]}</p>
        <CodeBlock code={code} label={PLATFORMS.find(([id]) => id === platform)?.[1]} />
        {!key && <Note>Escribe tu clave pública en el campo «Clave pública del asistente» para que el código quede listo para copiar.</Note>}
        {mode === 'token' && source === 'fixed' && (
          <Note tone="warn">
            Reemplaza <code>{'{{TOKEN_GENERADO_EN_TU_SERVIDOR}}'}</code> por el token que tu servidor pide en cada carga de página (paso 4). Vence a la
            hora por defecto; si el visitante deja la pestaña abierta más tiempo, usa la opción de URL o llama a{' '}
            <code>window.RagWidget.setToken(nuevoToken)</code>.
          </Note>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paso 4: código del servidor                                           */
/* ------------------------------------------------------------------ */

type Lang = 'csharp' | 'java' | 'node' | 'php' | 'curl';
const LANGS: ReadonlyArray<readonly [Lang, string]> = [
  ['csharp', 'C# (.NET)'],
  ['java', 'Java (Spring)'],
  ['node', 'Node.js'],
  ['php', 'PHP'],
  ['curl', 'cURL'],
];

function serverCode(lang: Lang, api: string): string {
  switch (lang) {
    case 'csharp':
      return `// Program.cs — endpoint de TU sitio que entrega el token al widget (data-token-url="/chat-token").
// La clave va en una variable de entorno o en un gestor de secretos, nunca en el navegador.
using System.Net.Http.Headers;
using System.Text.Json;

builder.Services.AddHttpClient("rag", c =>
{
    c.BaseAddress = new Uri("${api}/");
    c.DefaultRequestHeaders.Authorization =
        new AuthenticationHeaderValue("Bearer", builder.Configuration["RAG_API_KEY"]);
});

app.MapGet("/chat-token", async (IHttpClientFactory factory, HttpContext ctx) =>
{
    // Opcional: solo para usuarios con sesión → .RequireAuthorization()
    var http = factory.CreateClient("rag");
    var res = await http.PostAsJsonAsync("v1/widget-tokens", new
    {
        ttlSeconds = 3600,
        visitorId = ctx.User.Identity?.Name   // opcional: identifica al visitante en el registro
    });
    res.EnsureSuccessStatusCode();
    var body = await res.Content.ReadFromJsonAsync<JsonElement>();
    return Results.Json(new { token = body.GetProperty("token").GetString() });
});`;
    case 'java':
      return `// Controlador de TU sitio que entrega el token al widget (data-token-url="/chat-token").
// La clave va en una variable de entorno o en un gestor de secretos, nunca en el navegador.
@RestController
public class ChatTokenController {
    private final RestClient rag = RestClient.builder()
        .baseUrl("${api}")
        .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + System.getenv("RAG_API_KEY"))
        .build();

    @GetMapping("/chat-token")
    public Map<String, Object> token(Principal user) {   // Principal: opcional, con Spring Security
        Map<String, Object> request = new HashMap<>();
        request.put("ttlSeconds", 3600);
        if (user != null) request.put("visitorId", user.getName());

        Map<?, ?> body = rag.post().uri("/v1/widget-tokens")
            .contentType(MediaType.APPLICATION_JSON)
            .body(request)
            .retrieve().body(Map.class);
        return Map.of("token", body.get("token"));
    }
}`;
    case 'node':
      return `// Endpoint de TU sitio (Express) que entrega el token al widget (data-token-url="/chat-token").
app.get('/chat-token', async (req, res) => {
  const r = await fetch('${api}/v1/widget-tokens', {
    method: 'POST',
    headers: { Authorization: \`Bearer \${process.env.RAG_API_KEY}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttlSeconds: 3600, visitorId: req.user?.id }),
  });
  if (!r.ok) return res.status(502).end();
  const { token } = await r.json();
  res.json({ token });
});`;
    case 'php':
      return `<?php
// chat-token.php — entrega el token al widget (data-token-url="/chat-token.php").
$ch = curl_init('${api}/v1/widget-tokens');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ' . getenv('RAG_API_KEY'),
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => json_encode(['ttlSeconds' => 3600]),
]);
$body = json_decode(curl_exec($ch), true);
header('Content-Type: application/json');
echo json_encode(['token' => $body['token'] ?? null]);`;
    case 'curl':
      return `# Prueba rápida desde una terminal: devuelve {"token":"wt1…","expiresAt":"…"}
curl -X POST ${api}/v1/widget-tokens \\
  -H "Authorization: Bearer $RAG_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"ttlSeconds": 3600, "visitorId": "cliente-123"}'`;
  }
}

function ServerExamples() {
  const [lang, setLang] = useState<Lang>('csharp');
  const api = API_URL || 'https://rag-empresas-api.vercel.app';
  return (
    <>
      <ol className="grid gap-3 sm:grid-cols-3">
        {[
          ['Crea una clave secreta', 'Asistente y widget → Claves de API → «Crear clave». Se muestra una sola vez: guárdala (empieza por sk_live_).'],
          ['Guárdala en tu servidor', 'Como variable de entorno RAG_API_KEY o en tu gestor de secretos. Nunca en el HTML ni en JavaScript del navegador.'],
          ['Publica /chat-token', 'Un endpoint que pide el token a la API y lo devuelve como {"token": "…"}. El widget lo llama solo.'],
        ].map(([t, d], i) => (
          <li key={t} className="rounded-2xl border border-line bg-white p-4">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-sm font-semibold text-brand">{i + 1}</span>
            <p className="mt-3 text-sm font-medium">{t}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{d}</p>
          </li>
        ))}
      </ol>
      <Tabs tabs={LANGS} value={lang} onChange={setLang} label="Lenguaje" />
      <CodeBlock code={serverCode(lang, api)} label={LANGS.find(([id]) => id === lang)?.[1]} />
      <Note tone="warn">
        Si el chat es solo para clientes, protege <code>/chat-token</code> con el inicio de sesión de tu sitio: sin token, el widget no se abre. El token
        dura entre 1 minuto y 24 horas (<code>ttlSeconds</code>); al vencer, el widget pide otro a la misma URL sin que el visitante lo note.
      </Note>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Paso 5: vista previa y prueba real                                    */
/* ------------------------------------------------------------------ */

interface Bubble {
  from: 'bot' | 'user';
  text: string;
}

function PreviewSimulator({ side, setSide }: { side: 'left' | 'right'; setSide: (s: 'left' | 'right') => void }) {
  const [name, setName] = useState('Pat');
  const [color, setColor] = useState('#4338ca');
  const [welcome, setWelcome] = useState('¡Hola! Soy Pat. Pregúntame por nuestros productos, precios o envíos.');
  const [suggestions, setSuggestions] = useState('¿Qué telas de lino tienen?\n¿Hacen envíos a todo el país?');
  const [open, setOpen] = useState(true);
  const [chat, setChat] = useState<Bubble[]>([]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const chips = suggestions.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#4338ca';

  function ask(q: string) {
    if (!q.trim() || typing) return;
    setChat((c) => [...c, { from: 'user', text: q.trim() }]);
    setDraft('');
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setChat((c) => [
        ...c,
        {
          from: 'bot',
          text: `Esto es una vista previa. En tu sitio, ${name || 'el asistente'} responde con la información de tus documentos e indica de cuál sale.`,
        },
      ]);
    }, 900);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5 text-sm">
        <p className="font-medium">Prueba cómo se verá</p>
        <label className="space-y-1">
          <span className="text-xs text-muted">Nombre</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="h-9 w-full rounded-lg border border-line-strong px-3 outline-none focus:border-brand" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Color</span>
          <span className="flex items-center gap-2">
            <input type="color" value={safeColor} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-line-strong" />
            <input value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-full rounded-lg border border-line-strong px-3 font-mono text-[13px] outline-none focus:border-brand" />
          </span>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Mensaje de bienvenida</span>
          <textarea value={welcome} onChange={(e) => setWelcome(e.target.value)} rows={3} className="w-full rounded-lg border border-line-strong px-3 py-2 outline-none focus:border-brand" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Preguntas sugeridas (una por línea)</span>
          <textarea value={suggestions} onChange={(e) => setSuggestions(e.target.value)} rows={3} className="w-full rounded-lg border border-line-strong px-3 py-2 outline-none focus:border-brand" />
        </label>
        <div className="flex gap-2">
          {(['right', 'left'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSide(s)} aria-pressed={side === s} className={`flex-1 rounded-lg border px-2 py-1.5 ${side === s ? 'border-brand bg-brand-soft font-medium' : 'border-line'}`}>
              {s === 'right' ? 'Derecha' : 'Izquierda'}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setChat([])} className="text-left text-xs font-medium text-brand hover:text-brand-hover">
          Reiniciar conversación
        </button>
        <p className="text-xs leading-relaxed text-muted">Estos valores se guardan en la app, en «Asistente y widget». Aquí solo son una simulación.</p>
      </div>

      {/* Sitio de ejemplo */}
      <div className="relative min-h-[560px] overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex items-center gap-2 border-b border-line bg-canvas px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]" />
          <span className="ml-3 truncate rounded-full border border-line bg-white px-3 py-0.5 text-xs text-muted">https://www.tuempresa.com</span>
        </div>
        <div className="space-y-3 p-6" aria-hidden>
          <div className="h-5 w-48 rounded bg-line" />
          <div className="h-3 w-80 max-w-full rounded bg-canvas" />
          <div className="h-3 w-64 max-w-full rounded bg-canvas" />
          <div className="grid grid-cols-3 gap-3 pt-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-canvas" />
            ))}
          </div>
        </div>

        <div className={`absolute bottom-4 flex flex-col gap-3 ${side === 'right' ? 'right-4 items-end' : 'left-4 items-start'}`}>
          {open && (
            <div className="flex h-[420px] w-[min(330px,calc(100vw-80px))] flex-col overflow-hidden rounded-[20px] border border-line bg-white shadow-[0_18px_50px_rgba(14,17,22,.18)]">
              <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: safeColor }}>
                <span className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20">
                    <BotIcon size={16} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold leading-tight">{name || 'Asistente'}</span>
                    <span className="block text-[11px] opacity-80">Responde con la información de la empresa</span>
                  </span>
                </span>
                <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar vista previa" className="rounded-md p-1 hover:bg-white/15">
                  <CloseIcon size={16} />
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 text-[13px]">
                <p className="max-w-[85%] rounded-2xl rounded-tl-md border border-line bg-canvas px-3 py-2">{welcome || '…'}</p>
                {chat.length === 0 && chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((c) => (
                      <button key={c} type="button" onClick={() => ask(c)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-canvas" style={{ borderColor: safeColor, color: safeColor }}>
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                {chat.map((b, i) =>
                  b.from === 'user' ? (
                    <p key={i} className="max-w-[85%] self-end rounded-2xl rounded-tr-md px-3 py-2 text-white" style={{ background: safeColor }}>
                      {b.text}
                    </p>
                  ) : (
                    <p key={i} className="max-w-[85%] rounded-2xl rounded-tl-md border border-line bg-canvas px-3 py-2">
                      {b.text}
                    </p>
                  ),
                )}
                {typing && <p className="w-14 animate-pulse rounded-2xl border border-line bg-canvas px-3 py-2 text-muted">•••</p>}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(draft);
                }}
                className="flex gap-2 border-t border-line p-2.5"
              >
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escribe tu pregunta…" className="h-9 min-w-0 flex-1 rounded-lg border border-line px-3 text-[13px] outline-none" />
                <button type="submit" aria-label="Enviar" className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ background: safeColor }}>
                  <SendIcon size={15} />
                </button>
              </form>
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Cerrar chat' : 'Abrir chat'}
            className="flex h-14 w-14 items-center justify-center rounded-[18px] text-white shadow-[0_6px_20px_rgba(0,0,0,.2)]"
            style={{ background: safeColor }}
          >
            {open ? <CloseIcon size={24} /> : <ChatIcon size={26} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function RealTest({ keyValue, origin }: { keyValue: string; origin: string }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const key = keyValue.trim();
  const valid = KEY_RE.test(key);
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Prueba con tu asistente real</p>
          <p className="text-sm text-muted">Abre aquí mismo el chat de tu asistente (modo público y widget activado). Las preguntas cuentan en el límite diario.</p>
        </div>
        <button
          type="button"
          disabled={!valid}
          onClick={() => setLoaded(key)}
          className="inline-flex h-10 items-center rounded-[10px] bg-brand px-4 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {loaded ? 'Recargar' : 'Abrir mi asistente'}
        </button>
      </div>
      {!valid && <p className="mt-2 text-xs text-muted">Escribe tu clave pública en el paso 3 para habilitar la prueba.</p>}
      {loaded && (
        <div className="mt-4 flex justify-center rounded-xl bg-canvas p-4">
          <iframe
            key={loaded}
            src={`${origin}/embed/${loaded}`}
            title="Asistente real"
            className="h-[560px] w-full max-w-[380px] rounded-[20px] border-0 bg-white shadow-[0_18px_50px_rgba(14,17,22,.18)]"
          />
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        ¿Quieres probarlo en una página aparte, incluso en modo protegido? Usa la{' '}
        <a href="https://rag-empresas-widget-demo.vercel.app" target="_blank" rel="noreferrer" className="text-brand hover:text-brand-hover">
          página de prueba del widget
        </a>
        .
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Verificación, problemas y referencia                                  */
/* ------------------------------------------------------------------ */

const CHECKS: Array<{ text: string; tokenOnly?: boolean }> = [
  { text: 'Marqué «Activado» en «Widget para tu sitio web» (Asistente y widget) y guardé.' },
  { text: 'El dominio de mi sitio está en «Dominios autorizados», con https:// y exactamente como en la barra del navegador (con o sin www).' },
  { text: 'Pegué el código en todas las páginas, antes de </body>.' },
  { text: 'Creé una clave secreta y la guardé solo en mi servidor.', tokenOnly: true },
  { text: 'Mi URL /chat-token responde {"token": "wt1…"} cuando la abro en el navegador.', tokenOnly: true },
  { text: 'Revisé el límite de mensajes por día y las preguntas sugeridas.' },
  { text: 'Probé el chat en mi sitio publicado, en una ventana privada y en el móvil.' },
];

function Checklist({ mode }: { mode: Mode }) {
  const items = CHECKS.filter((c) => !c.tokenOnly || mode === 'token');
  const [done, setDone] = useState<Set<string>>(new Set());
  const count = items.filter((i) => done.has(i.text)).length;
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {count} de {items.length} listos
        </span>
        {count === items.length && <span className="font-medium text-ok">¡Todo listo para publicar!</span>}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={count} aria-valuemin={0} aria-valuemax={items.length}>
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(count / items.length) * 100}%` }} />
      </div>
      <ul className="mt-4 space-y-2.5">
        {items.map((i) => (
          <li key={i.text}>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={done.has(i.text)}
                onChange={(e) =>
                  setDone((d) => {
                    const n = new Set(d);
                    if (e.target.checked) n.add(i.text);
                    else n.delete(i.text);
                    return n;
                  })
                }
                className="mt-0.5 h-4 w-4"
              />
              <span className={done.has(i.text) ? 'text-muted line-through' : ''}>{i.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PROBLEMS: Array<{ q: string; a: ReactNode; tags: string }> = [
  {
    q: 'No aparece el botón del chat',
    tags: 'boton no aparece nada consola',
    a: (
      <>
        Abre la consola del navegador (F12 → Consola) y busca mensajes que empiecen por <code>[widget]</code>. Si no hay ninguno, el{' '}
        <code>&lt;script&gt;</code> no se está cargando: revisa que esté en la página publicada (no solo en borrador) y que ningún plugin de caché u
        optimización lo haya quitado.
      </>
    ),
  },
  {
    q: '[widget] Chatbot no disponible',
    tags: 'chatbot no disponible clave desactivado',
    a: <>El widget está desactivado o la clave del script no coincide (por ejemplo, porque generaste una clave nueva). Actívalo y copia otra vez el código.</>,
  },
  {
    q: 'El botón aparece pero el chat sale en blanco o dice «rechazó la conexión»',
    tags: 'blanco rechazo conexion frame-ancestors dominio iframe',
    a: (
      <>
        Tu dominio no está autorizado. Agrega la dirección exacta que ves en el navegador, por ejemplo <code>https://www.tuempresa.com</code> y también{' '}
        <code>https://tuempresa.com</code> si se usan ambas. Los cambios tardan hasta 1 minuto.
      </>
    ),
  },
  {
    q: '[widget] Modo protegido: falta data-token o data-token-url',
    tags: 'modo protegido token falta',
    a: <>El asistente está en modo protegido y el script no tiene de dónde sacar el token. Agrega data-token-url (paso 3) o cambia el modo a público.</>,
  },
  {
    q: 'No se pudo obtener el token del chat (401, 403, 404 o 500)',
    tags: 'token 401 403 404 500 chat-token servidor',
    a: (
      <>
        La URL de <code>data-token-url</code> falló. Ábrela en el navegador: debe devolver <code>{'{"token":"wt1…"}'}</code>. Un 404 indica ruta
        equivocada; un 401/403 que exige sesión (normal si el chat es solo para clientes); un 500 suele ser la variable <code>RAG_API_KEY</code> vacía
        o una clave revocada.
      </>
    ),
  },
  {
    q: 'El chat responde «El asistente alcanzó su límite de mensajes por hoy»',
    tags: 'limite diario mensajes',
    a: <>Se llegó al «Límite de mensajes por día». Súbelo en Asistente y widget; en Uso y gastos ves cuántos mensajes llevas hoy.</>,
  },
  {
    q: 'Funciona en mi computador pero no en otro dominio o subdominio',
    tags: 'subdominio staging pruebas otro dominio',
    a: <>Cada origen se autoriza por separado: https://tienda.tuempresa.com y https://www.tuempresa.com son distintos. Agrega también el de pruebas si lo usas.</>,
  },
];

function Troubleshooting() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(PROBLEMS[0].q);
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = useMemo(() => {
    const q = norm(query.trim());
    return q ? PROBLEMS.filter((p) => norm(`${p.q} ${p.tags}`).includes(q)) : PROBLEMS;
  }, [query]);
  return (
    <div className="flex flex-col gap-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Busca el mensaje que ves, p. ej. «token» o «dominio»"
        aria-label="Buscar problema"
        className="h-11 w-full rounded-xl border border-line-strong bg-white px-4 text-sm outline-none focus:border-brand"
      />
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
        {list.length === 0 && <p className="p-4 text-sm text-muted">Sin resultados. Prueba con otra palabra.</p>}
        {list.map((p) => {
          const isOpen = open === p.q;
          return (
            <div key={p.q}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : p.q)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-medium hover:bg-canvas"
              >
                {p.q}
                <span className={`text-muted transition ${isOpen ? 'rotate-45' : ''}`}>+</span>
              </button>
              {isOpen && <div className="px-4 pb-4 text-sm leading-relaxed text-ink-2">{p.a}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Reference() {
  const rows: Array<[string, string, string]> = [
    ['data-bot', 'Obligatorio', 'Clave pública del asistente (bot_…). No es secreta.'],
    ['data-position', 'left | right', 'Esquina del botón. Por defecto, right.'],
    ['data-token-url', 'Modo protegido', 'URL de tu sitio que devuelve {"token": "…"} o el token en texto. Se llama con las cookies del visitante y otra vez cuando el token vence.'],
    ['data-token', 'Modo protegido', 'Token ya generado al armar la página. Alternativa a data-token-url.'],
    ['window.RagWidget.setToken(t)', 'JavaScript', 'Entrega un token nuevo al chat abierto (por ejemplo, después de iniciar sesión).'],
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Atributo / función</th>
            <th className="px-4 py-3 font-medium">Valores</th>
            <th className="px-4 py-3 font-medium">Descripción</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([a, v, d]) => (
            <tr key={a}>
              <td className="px-4 py-3 font-mono text-[12.5px] text-brand">{a}</td>
              <td className="px-4 py-3 text-muted">{v}</td>
              <td className="px-4 py-3 text-ink-2">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                               */
/* ------------------------------------------------------------------ */

function useActiveSection(): string {
  const [active, setActive] = useState<string>(SECTIONS[0][0]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    SECTIONS.forEach(([id]) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);
  return active;
}

export function WidgetGuide() {
  const origin = useOrigin();
  const urlKey = useKeyFromUrl();
  const [typedKey, setTypedKey] = useState<string | null>(null);
  const keyValue = typedKey ?? urlKey;
  const [mode, setMode] = useState<Mode>('public');
  const [side, setSide] = useState<'left' | 'right'>('right');
  const active = useActiveSection();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-side-line bg-side text-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-brand">
              <LogoIcon size={18} />
            </span>
            <span className="text-[15px] font-semibold">RAG Empresas</span>
            <span className="hidden text-sm text-side-muted sm:inline">· Documentación</span>
          </Link>
          <Link href="/dashboard" className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-sm hover:bg-white/15">
            <SettingsIcon size={15} />
            Ir a la app
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Contenido" className="hidden lg:block">
          <ul className="sticky top-24 space-y-0.5 text-sm">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className={`block rounded-lg px-3 py-1.5 transition ${active === id ? 'bg-white font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-col gap-12">
          <div>
            <p className="text-sm font-medium text-brand">Guía · Widget</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Pon tu asistente en el sitio web de tu empresa</h1>
            <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-muted">
              En unos 10 minutos tus visitantes podrán preguntarle a tus documentos desde cualquier página. Esta guía te lleva paso a paso y genera el
              código exacto para tu plataforma.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              {['Sin instalar nada en tu servidor (modo público)', 'WordPress, Shopify, GTM, Next.js y HTML', 'Ejemplos de servidor en C#, Java, Node y PHP'].map((t) => (
                <span key={t} className="rounded-full border border-line bg-white px-3 py-1 text-ink-2">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <Section id="resumen" title="Cómo funciona" intro="Pegas una línea de código en tu sitio. Esa línea dibuja un botón flotante que abre el chat de tu asistente, que responde con la información de los documentos del proyecto.">
            <Figure scroll caption="El chat se abre en una ventana segura que solo se muestra en los dominios que autorices.">
              <FlowDiagram />
            </Figure>
            <Figure caption="Así lo ven tus visitantes: un botón en la esquina y el chat con las fuentes de cada respuesta.">
              <BrowserMock side={side} />
            </Figure>
          </Section>

          <Section
            id="configurar"
            title="1. Configura el asistente"
            intro="En la app, abre tu proyecto y entra a «Asistente y widget». Necesitas ser propietario o administrador de la empresa."
          >
            <FieldsExplorer />
            <Note>
              Las <strong>instrucciones para el asistente</strong> y el <strong>idioma</strong> también están en esa pantalla: úsalas para indicar el
              tono, qué temas no tratar o a quién derivar consultas comerciales.
            </Note>
          </Section>

          <Section id="modo" title="2. Elige: público o protegido" intro="Elige el modo según quién debe poder usar el chat. Puedes cambiarlo cuando quieras.">
            <ModePicker mode={mode} setMode={setMode} />
          </Section>

          <Section id="codigo" title="3. Genera el código para tu plataforma" intro="Escribe tu clave pública, elige la plataforma y copia el código. Se ajusta solo al modo que elegiste.">
            <SnippetBuilder origin={origin} keyValue={keyValue} setKey={setTypedKey} mode={mode} side={side} setSide={setSide} />
          </Section>

          <Section
            id="servidor"
            title="4. Token en tu servidor"
            intro={
              mode === 'token'
                ? 'En modo protegido tu servidor entrega un token temporal al widget. La clave secreta nunca llega al navegador.'
                : 'Solo hace falta en modo protegido. Si elegiste el modo público, puedes saltar al paso 5.'
            }
          >
            {mode === 'token' ? (
              <ServerExamples />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line-strong bg-white p-5 text-sm">
                <span className="text-muted">Estás viendo la guía del modo público.</span>
                <button type="button" onClick={() => setMode('token')} className="font-medium text-brand hover:text-brand-hover">
                  Ver los pasos del modo protegido
                </button>
              </div>
            )}
          </Section>

          <Section id="probar" title="5. Prueba el widget" intro="Ajusta los colores y textos en la simulación y luego abre tu asistente real para hacerle preguntas de verdad.">
            <PreviewSimulator side={side} setSide={setSide} />
            <RealTest keyValue={keyValue} origin={origin} />
          </Section>

          <Section id="verificar" title="Lista de verificación" intro="Marca cada punto antes de anunciar el chat a tus clientes.">
            <Checklist mode={mode} />
          </Section>

          <Section id="problemas" title="Solución de problemas" intro="La mayoría de los errores se ven en la consola del navegador (F12) con el prefijo [widget].">
            <Troubleshooting />
          </Section>

          <Section id="referencia" title="Referencia" intro="Todo lo que acepta el script del widget.">
            <Reference />
            <p className="text-sm text-muted">
              ¿Necesitas respuestas desde tu propio backend, sin widget? Usa <code>POST /v1/chat</code> con tu clave secreta; los ejemplos están en{' '}
              <strong className="text-ink-2">Asistente y widget → Claves de API</strong>.
            </p>
          </Section>
        </main>
      </div>
    </div>
  );
}
