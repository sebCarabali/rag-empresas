'use client';

import { useEffect, useState } from 'react';
import { API_URL, api, type ApiKey } from '@/lib/api';
import { Button, Card, ErrorText, Input } from './ui';

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
  return (
    <Card className="space-y-5">
      <div>
        <h2 className="font-semibold">Claves secretas de API</h2>
        <p className="mt-1 text-sm text-slate-500">
          La API genera la clave y la muestra <strong>una sola vez</strong>; solo se guarda su huella (hash), así que nadie
          puede volver a verla. Úsala únicamente en el servidor de tu sitio: con ella se emiten los tokens temporales del widget
          protegido y se puede preguntar al asistente por API. Nunca la pongas en el HTML ni en JavaScript del navegador.
        </p>
      </div>
      <ErrorText>{error}</ErrorText>

      {created?.key && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">Copia la clave ahora: no se volverá a mostrar.</p>
          <div className="flex gap-2">
            <code className="flex-1 break-all rounded bg-white px-2 py-1.5 text-xs">{created.key}</code>
            <Button type="button" variant="secondary" onClick={() => copy(created.key!, 'new')}>
              {copied === 'new' ? 'Copiada ✓' : 'Copiar'}
            </Button>
          </div>
          <p className="text-xs text-amber-900">Guárdala como variable de entorno <code>RAG_API_KEY</code> en tu servidor.</p>
          <button type="button" className="text-xs text-amber-900 underline" onClick={() => setCreated(null)}>
            Ya la guardé
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Nombre (p. ej. Sitio web)" />
        <Button type="button" onClick={() => void create()}>Generar clave</Button>
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
        {keys?.length === 0 && <li className="px-3 py-2 text-slate-500">Aún no hay claves.</li>}
        {keys?.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="font-medium">{k.name}</span>
            <code className="text-xs text-slate-500">{k.prefix}…{k.last4}</code>
            <span className="text-xs text-slate-500">creada {fmt(k.created_at)} · último uso {fmt(k.last_used_at)}</span>
            {k.revoked_at ? (
              <span className="ml-auto text-xs text-red-600">revocada {fmt(k.revoked_at)}</span>
            ) : (
              <button type="button" onClick={() => void revoke(k)} className="ml-auto text-xs text-red-600 hover:text-red-800">
                Revocar
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <p className="text-sm font-medium">Cómo usarla en tu servidor</p>
        <div className="flex flex-wrap gap-2">
          {LANGS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLang(id)}
              className={`rounded-full border px-3 py-1 text-xs ${lang === id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{code}</pre>
        <button type="button" onClick={() => copy(code, 'code')} className="text-xs font-medium text-slate-700 hover:text-slate-900">
          {copied === 'code' ? 'Copiado ✓' : 'Copiar ejemplo'}
        </button>
      </div>

      {publicKey && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <p className="text-sm font-medium">Probar el modo protegido sin servidor</p>
          <p className="text-xs text-slate-500">
            Genera un token de prueba válido por 1 hora y ábrelo en la página de prueba (agrega su dominio en «Dominios
            autorizados»).
          </p>
          <Button type="button" variant="secondary" onClick={() => void makeTestToken()}>
            Generar token de prueba
          </Button>
          {testToken && (
            <p className="text-xs">
              Vence {fmt(testToken.expiresAt)} ·{' '}
              <a
                className="font-medium text-blue-700 underline"
                target="_blank"
                rel="noopener noreferrer"
                href={`${DEMO_URL}/?bot=${publicKey}&token=${encodeURIComponent(testToken.token)}`}
              >
                Abrir en la página de prueba
              </a>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
