'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type UsageDay, type UsageReport, type WarmRun } from '@/lib/api';
import { Button, Card, ErrorText, Spinner } from './ui';

/** Orden fijo de las series (paleta categórica validada para daltonismo). */
const SERIES = [
  { key: 'gemini', label: 'Modelo principal', color: '#2a78d6' },
  { key: 'groq', label: 'Respaldo', color: '#eb6834' },
  { key: 'exact', label: 'Caché exacta', color: '#1baf7a' },
  { key: 'semantic', label: 'Caché por significado', color: '#eda100' },
] as const;
type SeriesKey = (typeof SERIES)[number]['key'];

const CHANNELS: Record<UsageDay['channel'], string> = {
  app: 'Chat del equipo',
  widget: 'Widget del sitio',
  eval: 'Pruebas automáticas',
  warm: 'Precalentamiento',
  ocr: 'OCR de documentos',
  enrich: 'Descripciones web',
};
/** Canales que son preguntas de personas (el gráfico y el % de caché se calculan con estos). */
const PEOPLE = new Set<UsageDay['channel']>(['app', 'widget']);

const num = (v: number | string | null | undefined) => Number(v ?? 0);
const usd = (v: number) =>
  v === 0 ? 'US$ 0' : v < 0.01 ? `US$ ${v.toFixed(4)}` : `US$ ${v.toLocaleString('es', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const int = (v: number) => v.toLocaleString('es');
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');

interface DayTotals {
  day: string;
  gemini: number;
  groq: number;
  exact: number;
  semantic: number;
}

function summarize(daily: UsageDay[]) {
  const byDay = new Map<string, DayTotals>();
  const byChannel = new Map<UsageDay['channel'], { total: number; cached: number; cost: number; tokens: number }>();
  let questions = 0;
  let cached = 0;
  let semantic = 0;
  let groq = 0;
  let cost = 0;
  let companyCost = 0;
  let generatedPeopleCost = 0;
  let generatedPeople = 0;
  for (const d of daily) {
    const c = num(d.cost_usd);
    cost += c;
    companyCost += num(d.company_cost);
    const ch = byChannel.get(d.channel) ?? { total: 0, cached: 0, cost: 0, tokens: 0 };
    ch.total += d.total;
    ch.cached += d.cache_exact + d.cache_semantic;
    ch.cost += c;
    ch.tokens += num(d.input_tokens) + num(d.output_tokens);
    byChannel.set(d.channel, ch);
    if (!PEOPLE.has(d.channel)) continue;
    const t = byDay.get(d.day) ?? { day: d.day, gemini: 0, groq: 0, exact: 0, semantic: 0 };
    const hits = d.cache_exact + d.cache_semantic;
    t.exact += d.cache_exact;
    t.semantic += d.cache_semantic;
    t.groq += d.groq;
    t.gemini += Math.max(0, d.total - hits - d.groq);
    byDay.set(d.day, t);
    questions += d.total;
    cached += hits;
    semantic += d.cache_semantic;
    groq += d.groq;
    generatedPeople += d.total - hits;
    generatedPeopleCost += c;
  }
  const avgCost = generatedPeople ? generatedPeopleCost / generatedPeople : 0;
  return {
    days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    channels: [...byChannel.entries()],
    questions,
    cached,
    semantic,
    groq,
    cost,
    companyCost,
    saved: avgCost * cached,
    avgCost,
  };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Barras apiladas por día: de dónde salió cada respuesta. */
function DailyChart({ days }: { days: DayTotals[] }) {
  const [hover, setHover] = useState<DayTotals | null>(null);
  const max = Math.max(1, ...days.map((d) => d.gemini + d.groq + d.exact + d.semantic));
  const height = 160;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative">
        <div className="flex items-end gap-1 border-b border-line" style={{ height }} onMouseLeave={() => setHover(null)}>
          {days.map((d) => {
            const total = d.gemini + d.groq + d.exact + d.semantic;
            return (
              <button
                key={d.day}
                type="button"
                onMouseEnter={() => setHover(d)}
                onFocus={() => setHover(d)}
                aria-label={`${d.day}: ${total} preguntas`}
                className="flex h-full min-w-[6px] flex-1 flex-col-reverse items-stretch gap-[2px] rounded-sm hover:bg-canvas focus:bg-canvas focus:outline-none"
              >
                {SERIES.map((s, i) => {
                  const v = d[s.key as SeriesKey];
                  if (!v) return null;
                  const top = SERIES.slice(i + 1).every((n) => !d[n.key as SeriesKey]);
                  return (
                    <span
                      key={s.key}
                      className={top ? 'rounded-t' : ''}
                      style={{ height: `${(v / max) * (height - 8)}px`, background: s.color }}
                    />
                  );
                })}
              </button>
            );
          })}
        </div>
        {hover && (
          <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-2xl border border-line bg-white px-3 py-2 text-xs shadow-md">
            <p className="font-medium text-ink">{new Date(`${hover.day}T12:00:00`).toLocaleDateString('es', { dateStyle: 'medium' })}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 text-muted">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.label}: <span className="tabular-nums text-ink">{hover[s.key as SeriesKey]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-between text-[11px] text-muted">
        <span>{days[0] && new Date(`${days[0].day}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>
        <span>máx. {max} por día</span>
        <span>{days.at(-1) && new Date(`${days.at(-1)!.day}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>
      </div>
    </div>
  );
}

const WARM_STATUS: Record<WarmRun['status'], string> = {
  queued: 'en cola',
  running: 'generando',
  done: 'terminado',
  failed: 'falló',
  skipped: 'omitido',
};

export function UsageTab({ projectId }: { projectId: string }) {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [warmRuns, setWarmRuns] = useState<WarmRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.usage(projectId, days).then(
      (r) => !cancelled && setReport(r),
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, days]);

  useEffect(() => {
    api.warmRuns(projectId).then(setWarmRuns, () => undefined);
  }, [projectId]);

  const activeWarm = warmRuns.find((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    if (!activeWarm) return;
    const timer = setInterval(() => api.warmRuns(projectId).then(setWarmRuns, () => undefined), 4000);
    return () => clearInterval(timer);
  }, [projectId, activeWarm]);

  const summary = useMemo(() => (report ? summarize(report.daily) : null), [report]);

  async function warm() {
    setError(null);
    try {
      const run = await api.warmCache(projectId);
      setWarmRuns((list) => [run, ...list]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const lastWarm = warmRuns[0];
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          De dónde salieron las respuestas y cuánto costaron. El gasto es un estimado con los precios públicos por token
          {report &&
            ` (Gemini US$ ${report.prices.gemini.input}/${report.prices.gemini.output}, Groq US$ ${report.prices.groq.input}/${report.prices.groq.output}${report.prices.openai ? `, OpenAI US$ ${report.prices.openai.input}/${report.prices.openai.output}` : ''}${report.prices.mistral ? ` y Mistral US$ ${report.prices.mistral.input}/${report.prices.mistral.output}` : ''} por millón de tokens de entrada/salida)`};
          no incluye el cargo aparte de la búsqueda de Google de las descripciones web.
        </p>
        <select
          value={days}
          onChange={(e) => {
            setReport(null);
            setDays(Number(e.target.value));
          }}
          className="rounded-lg border border-line-strong px-2 py-1 text-sm"
          aria-label="Período"
        >
          <option value={7}>Últimos 7 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
        </select>
      </div>
      <ErrorText>{error}</ErrorText>
      {!report && !error && <Spinner />}

      {summary && report && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Preguntas (equipo + sitio web)" value={int(summary.questions)} />
            <Stat
              label="Respondidas desde la caché"
              value={pct(summary.cached, summary.questions)}
              hint={`${int(summary.cached)} respuestas · ${int(summary.semantic)} por significado`}
            />
            <Stat label="Gasto estimado" value={usd(summary.cost)} hint={`${usd(summary.companyCost)} con la clave de la empresa`} />
            <Stat
              label="Ahorro estimado por la caché"
              value={usd(summary.saved)}
              hint={summary.avgCost ? `${usd(summary.avgCost)} por respuesta generada` : undefined}
            />
          </div>
          <p className="text-xs text-muted">
            {int(summary.groq)} respuestas usaron el modelo de respaldo · {int(report.cachedAnswers)} respuestas guardadas en la
            caché ahora · la caché por significado reutiliza una pregunta parecida si la similitud es de al menos{' '}
            {Math.round(report.semanticThreshold * 100)} % y menciona las mismas cifras y términos del catálogo.
          </p>

          <Card className="space-y-3 !p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Respuestas por día y origen</p>
              <button onClick={() => setShowTable((v) => !v)} className="text-xs text-muted underline">
                {showTable ? 'Ver gráfico' : 'Ver tabla'}
              </button>
            </div>
            {summary.days.length === 0 ? (
              <p className="text-sm text-muted">Todavía no hay preguntas en este período.</p>
            ) : showTable ? (
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 font-normal">Día</th>
                    {SERIES.map((s) => (
                      <th key={s.key} className="py-1 text-right font-normal">{s.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.days.map((d) => (
                    <tr key={d.day} className="border-t border-line">
                      <td className="py-1">{d.day}</td>
                      {SERIES.map((s) => (
                        <td key={s.key} className="py-1 text-right">{d[s.key as SeriesKey]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <DailyChart days={summary.days} />
            )}
          </Card>

          <Card className="!p-4">
            <p className="mb-2 text-sm font-medium">Por origen</p>
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 font-normal">Origen</th>
                  <th className="py-1 text-right font-normal">Llamadas</th>
                  <th className="py-1 text-right font-normal">Desde caché</th>
                  <th className="py-1 text-right font-normal">Tokens</th>
                  <th className="py-1 text-right font-normal">Gasto estimado</th>
                </tr>
              </thead>
              <tbody>
                {summary.channels.map(([channel, c]) => (
                  <tr key={channel} className="border-t border-line">
                    <td className="py-1.5">{CHANNELS[channel]}</td>
                    <td className="py-1.5 text-right">{int(c.total)}</td>
                    <td className="py-1.5 text-right">{pct(c.cached, c.total)}</td>
                    <td className="py-1.5 text-right">{int(c.tokens)}</td>
                    <td className="py-1.5 text-right">{usd(c.cost)}</td>
                  </tr>
                ))}
                {summary.channels.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-2 text-muted">Sin uso registrado en este período.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <Card className="space-y-3 !p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Precalentar la caché</p>
            <p className="max-w-xl text-xs text-muted">
              Genera de antemano las respuestas a las preguntas sugeridas del asistente y a las que más se repiten en los
              últimos 30 días (sitio web y equipo), para que se respondan al instante.
              {report?.autoWarm && ' Se hace solo cada vez que terminan de procesarse los documentos del proyecto.'}
            </p>
          </div>
          <Button onClick={() => void warm()} disabled={Boolean(activeWarm)}>
            {activeWarm ? 'Precalentando…' : 'Precalentar ahora'}
          </Button>
        </div>
        {lastWarm && (
          <p className="text-xs text-muted">
            Último: {new Date(lastWarm.created_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })} (
            {lastWarm.trigger === 'auto' ? 'automático' : 'manual'}) · {WARM_STATUS[lastWarm.status]} · {lastWarm.done}/
            {lastWarm.total} preguntas · {lastWarm.generated} respuestas nuevas
            {lastWarm.error && <span className="text-red-600"> · {lastWarm.error}</span>}
          </p>
        )}
      </Card>
    </section>
  );
}
