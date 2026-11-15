'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  PROVIDER_LABEL,
  type EmbeddingOption,
  type LlmProvider,
  type ModelSettings,
  type ModelsConfig,
  type ModelTestResult,
  type ProviderOption,
} from '@/lib/api';
import { Badge, Button, Card, ErrorText, Spinner } from './ui';

const KEY_CONSOLE: Record<LlmProvider, string> = {
  gemini: 'https://aistudio.google.com/apikey',
  openai: 'https://platform.openai.com/api-keys',
  groq: 'https://console.groq.com/keys',
  mistral: 'https://console.mistral.ai/api-keys',
};

const PROVIDER_BLURB: Record<LlmProvider, string> = {
  gemini: 'Buena relación calidad/precio y uso de herramientas del catálogo.',
  groq: 'Respuestas muy rápidas con modelos abiertos.',
  openai: 'Modelos GPT de OpenAI.',
  mistral: 'Modelos europeos multilingües, buenos con herramientas.',
};

const hasKey = (p?: ProviderOption) => Boolean(p?.configured);

function KeyBadge({ p }: { p: ProviderOption }) {
  if (p.configured) return <Badge tone="ok">Clave ···{p.last4}</Badge>;
  return <Badge tone="warn">Sin clave</Badge>;
}

function TestLine({ result }: { result: ModelTestResult | null }) {
  if (!result) return null;
  return (
    <p className={`rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-ok-soft text-ok' : 'bg-red-50 text-red-800'}`} role="status">
      {result.ok ? '✓ ' : '✗ '}
      {result.detail}
      {result.ms ? ` · ${(result.ms / 1000).toFixed(1)} s` : ''}
    </p>
  );
}

/** Selector de modelo: lista de sugerencias más campo libre (los proveedores sacan modelos nuevos seguido). */
function ModelPicker({
  provider,
  value,
  defaultModel,
  onChange,
  disabled,
  id,
}: {
  provider: ProviderOption;
  value: string | null;
  defaultModel: string;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  id: string;
}) {
  const current = value || defaultModel;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {provider.suggestions.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            title={s.note}
            onClick={() => onChange(s.id === defaultModel ? null : s.id)}
            className={`rounded-full border px-2.5 py-1 font-mono text-xs transition disabled:opacity-60 ${
              current === s.id ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink-2 hover:border-line-strong'
            }`}
          >
            {s.id}
          </button>
        ))}
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Modelo (puedes escribir otro de {provider.label})</span>
        <input
          id={id}
          list={`${id}-list`}
          value={value ?? ''}
          placeholder={`Por defecto: ${defaultModel}`}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.trim() || null)}
          spellCheck={false}
          className="h-10 w-full rounded-[9px] border border-line-strong px-3 font-mono text-[13px] outline-none focus:border-brand disabled:bg-canvas"
        />
        <datalist id={`${id}-list`}>
          {provider.suggestions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.note}
            </option>
          ))}
        </datalist>
      </label>
      <p className="text-xs text-muted">
        {provider.suggestions.find((s) => s.id === current)?.note ?? 'Modelo personalizado: pruébalo antes de guardar.'} · US${' '}
        {provider.price.input}/{provider.price.output} por millón de tokens (entrada/salida, estimado)
      </p>
    </div>
  );
}

function ProviderKeys({ projectId, config, onChanged }: { projectId: string; config: ModelsConfig; onChanged: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(p: LlmProvider) {
    const key = drafts[p]?.trim();
    if (!key) return;
    setBusy(p);
    setError(null);
    try {
      await api.setProviderKey(projectId, p, key);
      setDrafts((d) => ({ ...d, [p]: '' }));
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: LlmProvider) {
    if (!confirm(`¿Eliminar la clave de ${PROVIDER_LABEL[p]} de este asistente? Lo que dependa de ella (respaldo, embeddings, OCR o descripciones web) dejará de funcionar.`)) return;
    setBusy(p);
    setError(null);
    try {
      await api.deleteProviderKey(projectId, p);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">Claves de API de este asistente</h2>
        <p className="mt-1 text-sm text-muted">
          La plataforma no aporta claves: el asistente usa solo las que guardes aquí, y el consumo se cobra a tu cuenta de cada proveedor. Se
          verifican con el proveedor, se guardan cifradas (Supabase Vault) y nunca se vuelven a mostrar; solo sus últimos 4 caracteres. La de
          Gemini también se usa para leer PDF escaneados e imágenes (OCR) y para las descripciones web del catálogo.
        </p>
      </div>
      <ErrorText>{error}</ErrorText>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {config.providers.map((p) => (
          <li key={p.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                {p.label} <KeyBadge p={p} />
              </span>
              <a href={KEY_CONSOLE[p.id]} target="_blank" rel="noreferrer" className="text-xs text-brand hover:text-brand-hover">
                Obtener una clave
              </a>
            </div>
            {config.canEdit && (
              <div className="flex flex-wrap gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  value={drafts[p.id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  placeholder={p.configured ? 'Reemplazar la clave…' : 'Pega la clave…'}
                  aria-label={`Clave de ${p.label}`}
                  className="h-9 min-w-0 flex-1 rounded-[9px] border border-line-strong px-3 font-mono text-[13px] outline-none focus:border-brand"
                />
                <Button type="button" variant="secondary" onClick={() => void save(p.id)} disabled={busy === p.id || !drafts[p.id]?.trim()}>
                  {busy === p.id ? 'Verificando…' : 'Guardar'}
                </Button>
                {p.configured && (
                  <Button type="button" variant="ghost" onClick={() => void remove(p.id)} disabled={busy === p.id}>
                    Eliminar
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EmbeddingChoice({
  options,
  value,
  onChange,
  providers,
  disabled,
}: {
  options: EmbeddingOption[];
  value: string;
  onChange: (id: string) => void;
  providers: ProviderOption[];
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Modelo de embeddings" className="grid gap-2 sm:grid-cols-2">
      {options.map((m) => {
        const needs = m.provider === 'local' ? null : providers.find((p) => p.id === m.provider);
        const blocked = Boolean(needs && !hasKey(needs));
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={value === m.id}
            disabled={disabled || blocked}
            onClick={() => onChange(m.id)}
            className={`rounded-xl border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
              value === m.id ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line bg-white hover:border-line-strong'
            }`}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium">{m.label}</span>
              <span className="shrink-0 whitespace-nowrap">
                <Badge tone={m.pricePerM ? 'neutral' : 'ok'}>{m.pricePerM ? `US$ ${m.pricePerM}/M` : 'Gratis'}</Badge>
              </span>
            </span>
            <span className="mt-1 block text-xs text-muted">
              {m.dimensions} dimensiones · {m.provider === 'local' ? 'en el servidor' : `API de ${PROVIDER_LABEL[m.provider]}`}
            </span>
            <span className="mt-1.5 block text-xs leading-relaxed text-ink-2">{blocked ? `Guarda primero la clave de ${needs!.label}.` : m.note}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Pestaña «Modelos»: proveedor y modelo de lenguaje, respaldo, embeddings y claves de la empresa. */
export function ModelsPanel({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<ModelsConfig | null>(null);
  const [draft, setDraft] = useState<ModelSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tests, setTests] = useState<Record<string, ModelTestResult | 'running' | undefined>>({});

  const apply = useCallback((c: ModelsConfig) => {
    setConfig(c);
    setDraft(c.settings);
  }, []);

  const load = useCallback(() => api.models(projectId).then(apply, (e) => setError((e as Error).message)), [projectId, apply]);
  useEffect(() => {
    void load();
  }, [load]);

  // Mientras se reindexa, se actualiza el avance.
  const running = config?.reindex.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      api.models(projectId).then((c) => setConfig((prev) => (prev ? { ...prev, reindex: c.reindex } : c)), () => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [running, projectId]);

  if (error && !config) return <ErrorText>{error}</ErrorText>;
  if (!config || !draft) return <Spinner />;

  const provider = (id: LlmProvider) => config.providers.find((p) => p.id === id)!;
  const set = <K extends keyof ModelSettings>(k: K, v: ModelSettings[K]) => {
    setSaved(false);
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  };
  const embeddingValue = draft.embeddingModel || config.defaults.embeddingModel;
  const embeddingChanged = embeddingValue !== (config.settings.embeddingModel || config.defaults.embeddingModel);
  const llmChanged =
    draft.llmProvider !== config.settings.llmProvider || (draft.llmModel ?? null) !== (config.settings.llmModel ?? null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config.settings);

  async function test(key: string, body: Parameters<typeof api.testModel>[1]) {
    setTests((t) => ({ ...t, [key]: 'running' }));
    try {
      const r = await api.testModel(projectId, body);
      setTests((t) => ({ ...t, [key]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [key]: { ok: false, ms: 0, detail: (e as Error).message } }));
    }
  }

  async function save() {
    if (!draft) return;
    if (
      embeddingChanged &&
      !confirm(
        'Al cambiar el modelo de embeddings se recalcula el índice de búsqueda de todos los documentos del proyecto. Mientras termina, las respuestas usan sobre todo la búsqueda por palabras. ¿Continuar?',
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      apply(await api.saveModels(projectId, { ...draft, embeddingModel: embeddingValue }));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const testResult = (key: string) => {
    const r = tests[key];
    return r === 'running' ? null : (r ?? null);
  };
  const disabled = !config.canEdit;
  const fallbackProvider = draft.llmFallback === 'none' ? null : provider(draft.llmFallback);

  return (
    <div className="space-y-6">
      {!config.canEdit && (
        <p className="rounded-[10px] bg-canvas px-3.5 py-2.5 text-sm text-muted">Solo owner o admin pueden cambiar los modelos.</p>
      )}
      {!hasKey(provider(config.settings.llmProvider)) && (
        <p className="rounded-[10px] border border-amber-200 bg-warn-soft px-3.5 py-2.5 text-sm text-[#6b3d00]">
          Este asistente todavía no puede responder: guarda la clave de {PROVIDER_LABEL[config.settings.llmProvider]} (o de otro proveedor y
          elígelo como modelo de lenguaje).
        </p>
      )}

      <ProviderKeys projectId={projectId} config={config} onChanged={load} />

      <Card className="space-y-5">
        <div>
          <h2 className="font-semibold">Modelo de lenguaje</h2>
          <p className="mt-1 text-sm text-muted">El que redacta las respuestas en el chat, el widget y la API.</p>
        </div>
        <div role="radiogroup" aria-label="Proveedor" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {config.providers.map((p) => {
            const blocked = !hasKey(p);
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={draft.llmProvider === p.id}
                disabled={disabled || blocked}
                onClick={() => {
                  set('llmProvider', p.id);
                  set('llmModel', null);
                  if (draft.llmFallback === p.id) set('llmFallback', p.id === 'groq' ? 'gemini' : 'groq');
                }}
                className={`rounded-xl border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
                  draft.llmProvider === p.id ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line bg-white hover:border-line-strong'
                }`}
              >
                <span className="block text-sm font-semibold">{p.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">{PROVIDER_BLURB[p.id]}</span>
                <span className="mt-2 block">
                  <KeyBadge p={p} />
                </span>
              </button>
            );
          })}
        </div>
        <ModelPicker
          id="llm-model"
          provider={provider(draft.llmProvider)}
          value={draft.llmModel}
          defaultModel={config.defaults.llm[draft.llmProvider]}
          onChange={(v) => set('llmModel', v)}
          disabled={disabled}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || tests.llm === 'running'}
            onClick={() => void test('llm', { kind: 'llm', provider: draft.llmProvider, model: draft.llmModel })}
          >
            {tests.llm === 'running' ? 'Probando…' : 'Probar conexión'}
          </Button>
          <span className="text-xs text-muted">Envía una pregunta mínima con la clave que se usaría.</span>
        </div>
        <TestLine result={testResult('llm')} />
        {llmChanged && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-[#6b3d00]">
            Las respuestas guardadas en la caché son del modelo anterior: con el nuevo, cada pregunta se vuelve a generar la primera vez.
          </p>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold">Modelo de respaldo</h2>
          <p className="mt-1 text-sm text-muted">
            Responde solo si el principal falla o no empieza a responder a tiempo (necesita su propia clave guardada arriba). Sus respuestas
            quedan como provisionales en la caché: la próxima vez se intenta de nuevo con el principal.
          </p>
        </div>
        {!config.defaults.fallbackEnabled && (
          <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-muted">El respaldo está desactivado en la plataforma (LLM_FALLBACK=false).</p>
        )}
        <label className="block space-y-1">
          <span className="block text-sm font-medium">Proveedor de respaldo</span>
          <select
            value={draft.llmFallback}
            disabled={disabled}
            onChange={(e) => {
              set('llmFallback', e.target.value as ModelSettings['llmFallback']);
              set('llmFallbackModel', null);
            }}
            className="h-10 w-full rounded-[9px] border border-line-strong bg-white px-3 text-sm outline-none focus:border-brand sm:w-72"
          >
            <option value="none">Sin respaldo</option>
            {config.providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!hasKey(p)}>
                {p.label}
                {!hasKey(p) ? ' (falta la clave)' : ''}
              </option>
            ))}
          </select>
        </label>
        {fallbackProvider && (
          <>
            <ModelPicker
              id="fallback-model"
              provider={fallbackProvider}
              value={draft.llmFallbackModel}
              defaultModel={config.defaults.llm[fallbackProvider.id]}
              onChange={(v) => set('llmFallbackModel', v)}
              disabled={disabled}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || tests.fallback === 'running'}
              onClick={() => void test('fallback', { kind: 'llm', provider: fallbackProvider.id, model: draft.llmFallbackModel })}
            >
              {tests.fallback === 'running' ? 'Probando…' : 'Probar respaldo'}
            </Button>
            <TestLine result={testResult('fallback')} />
          </>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold">Modelo de embeddings</h2>
          <p className="mt-1 text-sm text-muted">
            Convierte documentos y preguntas en vectores para buscar por significado. Uno más preciso encuentra mejor los fragmentos en
            preguntas difíciles; cambiarlo recalcula el índice del proyecto (sin volver a leer los archivos ni gastar OCR).
          </p>
        </div>
        <EmbeddingChoice
          options={config.embeddings}
          value={embeddingValue}
          onChange={(id) => set('embeddingModel', id === config.defaults.embeddingModel ? null : id)}
          providers={config.providers}
          disabled={disabled}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || tests.embedding === 'running'}
            onClick={() => void test('embedding', { kind: 'embedding', model: embeddingValue })}
          >
            {tests.embedding === 'running' ? 'Probando…' : 'Probar embeddings'}
          </Button>
          <span className="text-xs text-muted">
            Índice actual: {config.reindex.indexedWith ?? 'sin indexar'}
            {config.reindex.status === 'running' && ` · reindexando ${config.reindex.done} de ${config.reindex.total}`}
            {config.reindex.status === 'failed' && ` · el último reindexado falló: ${config.reindex.error ?? ''}`}
          </span>
        </div>
        <TestLine result={testResult('embedding')} />
        {running && (
          <div className="h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={config.reindex.done} aria-valuemax={config.reindex.total}>
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${config.reindex.total ? (config.reindex.done / config.reindex.total) * 100 : 5}%` }}
            />
          </div>
        )}
      </Card>

      {config.canEdit && (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
          <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? 'Guardando…' : 'Guardar modelos'}
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setDraft(config.settings)}>
              Descartar cambios
            </Button>
          )}
          {saved && !dirty && <span className="text-sm text-ok">Guardado</span>}
          <ErrorText>{error}</ErrorText>
        </div>
      )}

    </div>
  );
}
