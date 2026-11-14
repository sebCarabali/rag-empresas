'use client';

import { useEffect, useState } from 'react';
import { API_URL, api, type ApiKey } from '@/lib/api';
import { Badge, Button, Card, ErrorText, Input, SectionTitle } from './ui';

const DEMO_URL = 'https://rag-empresas-widget-demo.vercel.app';

type Lang = 'curl' | 'csharp' | 'java' | 'node';
const LANGS: Array<[Lang, string]> = [
  ['curl', 'cURL'],
  ['csharp', 'C# (ASP.NET Core)'],
  ['java', 'Java (Spring)'],
  ['node', 'Node.js'],
];

/** Ejemplos para el servidor de la empresa: emitir el token del widget y preguntar por API. */
function examples(api: string): Record<Lang, string> {
  return {
    curl: `# Token temporal para el widget (1 h)
curl -X POST ${api}/v1/widget-tokens \\
  -H "Authorization: Bearer $RAG_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"ttlSeconds": 3600, "visitorId": "cliente-123"}'

# Pregunta directa desde tu servidor
curl -X POST ${api}/v1/chat \\
  -H "Authorization: Bearer $RAG_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"question": "¿Qué telas de lino tienen?"}'`,
    csharp: `using System.Net.Http.Headers;
using System.Text.Json;

// Program.cs — endpoint de TU sitio que entrega el token al widget (data-token-url="/chat-token").
// La clave va en una variable de entorno o en un gestor de secretos, nunca en el navegador.
builder.Services.AddHttpClient("rag", c =>
{
    c.BaseAddress = new Uri("${api}/");
    c.DefaultRequestHeaders.Authorization =
        new AuthenticationHeaderValue("Bearer", builder.Configuration["RAG_API_KEY"]);
});

app.MapGet("/chat-token", async (IHttpClientFactory factory) =>
{
    var http = factory.CreateClient("rag");
    var res = await http.PostAsJsonAsync("v1/widget-tokens", new { ttlSeconds = 3600 });
    res.EnsureSuccessStatusCode();
    var body = await res.Content.ReadFromJsonAsync<JsonElement>();
    return Results.Json(new { token = body.GetProperty("token").GetString() });
});`,
    java: `// Controlador de TU sitio que entrega el token al widget (data-token-url="/chat-token").
// La clave va en una variable de entorno o en un gestor de secretos, nunca en el navegador.
@RestController
public class ChatTokenController {
    private final RestClient rag = RestClient.builder()
        .baseUrl("${api}")
        .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + System.getenv("RAG_API_KEY"))
        .build();

    @GetMapping("/chat-token")
    public Map<String, Object> token() {
        Map<?, ?> body = rag.post().uri("/v1/widget-tokens")
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("ttlSeconds", 3600))
            .retrieve().body(Map.class);
        return Map.of("token", body.get("token"));
    }
}`,
    node: `// Endpoint de TU sitio (Express) que entrega el token al widget (data-token-url="/chat-token").
app.get('/chat-token', async (req, res) => {
  const r = await fetch('${api}/v1/widget-tokens', {
    method: 'POST',
    headers: { Authorization: \`Bearer \${process.env.RAG_API_KEY}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttlSeconds: 3600 }),
  });
  if (!r.ok) return res.status(502).end();
  const { token } = await r.json();
  res.json({ token });
});`,
  };
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** Claves secretas de API del proyecto y guía para el modo protegido del widget. */
export function ApiKeysPanel({ projectId, publicKey }: { projectId: string; publicKey: string | null }) {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState('Sitio web');
  const [created, setCreated] = useState<ApiKey | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>('csharp');
  const [testToken, setTestToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.apiKeys(projectId).then(setKeys, (e) => setError(e.message));
  }, [projectId]);

  function copy(text: string, id: string) {
    void navigator.clipboard.writeText(text);
    setCopied(id);
  }

  async function create() {
    setError(null);
    try {
      const key = await api.createApiKey(projectId, name.trim() || 'Clave');
      setCreated(key);
      setKeys((list) => [{ ...key, key: undefined }, ...(list ?? [])]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revoke(k: ApiKey) {
    if (!confirm(`¿Revocar «${k.name}» (${k.prefix}…${k.last4})? Los servidores que la usen dejarán de funcionar de inmediato.`)) return;
    try {
      await api.revokeApiKey(projectId, k.id);
      setKeys((list) => list?.map((x) => (x.id === k.id ? { ...x, revoked_at: new Date().toISOString() } : x)) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function makeTestToken() {
    setError(null);
    try {
      setTestToken(await api.widgetTestToken(projectId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const code = examples(API_URL)[lang];
  const active = keys?.filter((k) => !k.revoked_at) ?? [];
  const revoked = keys?.filter((k) => k.revoked_at) ?? [];
  return (
    <div className="flex flex-col gap-6">
      <Card className="space-y-5">
        <div className="flex flex-col gap-1.5">
          <SectionTitle aside={keys && <Badge tone={active.length ? 'ok' : 'neutral'}>{active.length} activa{active.length === 1 ? '' : 's'}</Badge>}>
            Claves secretas
          </SectionTitle>
          <p className="text-sm leading-relaxed text-muted">
            La API genera cada clave y la muestra <strong className="text-ink">una sola vez</strong>: solo se guarda su huella
            (hash), así que nadie puede volver a verla. Úsala únicamente en el servidor de tu sitio. Nunca la pongas en el HTML
            ni en el JavaScript del navegador.
          </p>
        </div>
        <ErrorText>{error}</ErrorText>

        {created?.key && (
          <div className="space-y-2.5 rounded-xl border border-[#f2d29b] bg-warn-soft p-4" role="status">
            <p className="text-sm font-semibold text-warn">Copia la clave ahora: no se volverá a mostrar.</p>
            <div className="flex flex-wrap gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-[#f2d29b] bg-white px-3 py-2 font-mono text-xs">{created.key}</code>
              <Button type="button" variant="secondary" onClick={() => copy(created.key!, 'new')}>
                {copied === 'new' ? 'Copiada ✓' : 'Copiar'}
              </Button>
            </div>
            <p className="text-xs text-warn">
              Guárdala como variable de entorno <code className="font-mono">RAG_API_KEY</code> en tu servidor.
            </p>
            <button type="button" className="text-xs font-medium text-warn underline" onClick={() => setCreated(null)}>
              Ya la guardé
            </button>
          </div>
        )}

        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label htmlFor="key-name" className="sr-only">
            Nombre de la clave
          </label>
          <Input
            id="key-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre (p. ej. Sitio web)"
            className="min-w-[200px] flex-1"
          />
          <Button type="submit" className="h-11">
            Generar clave
          </Button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#f8f9fb] text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Nombre</th>
                <th className="px-4 py-2.5 font-medium">Clave</th>
                <th className="px-4 py-2.5 font-medium">Creada</th>
                <th className="px-4 py-2.5 font-medium">Último uso</th>
                <th className="px-4 py-2.5 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!keys && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-muted">Cargando…</td>
                </tr>
              )}
              {keys?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-muted">Aún no hay claves. Genera la primera arriba.</td>
                </tr>
              )}
              {[...active, ...revoked].map((k) => (
                <tr key={k.id} className={`border-t border-line ${k.revoked_at ? 'text-muted' : ''}`}>
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3">
                    <code className="font-mono text-xs">{k.prefix}…{k.last4}</code>
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{fmt(k.created_at)}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{fmt(k.last_used_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {k.revoked_at ? (
                      <Badge tone="danger">Revocada</Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void revoke(k)}
                        className="text-xs font-medium text-red-700 hover:text-red-900"
                      >
                        Revocar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <SectionTitle>Cómo usarla en tu servidor</SectionTitle>
          <p className="text-sm leading-relaxed text-muted">
            Con la clave tu servidor emite los tokens temporales del widget protegido (<code className="font-mono text-xs">POST /v1/widget-tokens</code>)
            y puede preguntar al asistente directamente (<code className="font-mono text-xs">POST /v1/chat</code>).
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Lenguaje del ejemplo">
          {LANGS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={lang === id}
              onClick={() => setLang(id)}
              className={`h-9 rounded-full border px-3.5 text-xs font-medium ${
                lang === id ? 'border-brand bg-brand text-white' : 'border-line-strong text-ink-2 hover:bg-canvas'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <pre className="overflow-x-auto rounded-xl bg-side p-4 font-mono text-xs leading-relaxed text-slate-100">{code}</pre>
        <Button type="button" variant="secondary" onClick={() => copy(code, 'code')}>
          {copied === 'code' ? 'Copiado ✓' : 'Copiar ejemplo'}
        </Button>
      </Card>

      {publicKey && (
        <Card className="space-y-3">
          <SectionTitle>Probar el modo protegido sin servidor</SectionTitle>
          <p className="text-sm leading-relaxed text-muted">
            Genera un token de prueba válido por 1 hora y ábrelo en la página de prueba. Agrega antes su dominio en
            «Configuración → Dominios autorizados».
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => void makeTestToken()}>
              Generar token de prueba
            </Button>
            {testToken && (
              <span className="text-sm">
                Vence {fmt(testToken.expiresAt)} ·{' '}
                <a
                  className="font-medium text-brand underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`${DEMO_URL}/?bot=${publicKey}&token=${encodeURIComponent(testToken.token)}`}
                >
                  Abrir en la página de prueba
                </a>
              </span>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
