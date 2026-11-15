import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cacheModelKey, MissingModelKeyError } from '../../domain/llm/llm';
import { toSettings } from '../../infrastructure/persistence/supabase-model-settings.repository';
import { ModelSettingsService } from './model-settings.service';

const config = {
  defaultModels: { gemini: 'gemini-base', groq: 'groq-base', openai: 'openai-base', mistral: 'mistral-base' },
  embeddingModel: 'Xenova/multilingual-e5-base',
  llmFallback: true,
} as never;

/** Claves guardadas en el asistente (la plataforma no aporta ninguna). */
function service(projectKeys: Record<string, string>) {
  const keys = { getKey: async (_p: string, provider: string) => projectKeys[provider] ?? null };
  return new ModelSettingsService({ find: async () => toSettings(null) } as never, keys as never, config);
}

test('toSettings usa los valores por defecto sin fila (sin respaldo)', () => {
  assert.deepEqual(toSettings(null), {
    llmProvider: 'gemini',
    llmModel: null,
    llmFallback: 'none',
    llmFallbackModel: null,
    embeddingModel: null,
  });
});

test('ruta: principal y respaldo con las claves del asistente', async () => {
  const svc = service({ openai: 'sk-asistente', gemini: 'g-asistente' });
  const route = await svc.route('p', { ...toSettings(null), llmProvider: 'openai', llmModel: 'gpt-x', llmFallback: 'gemini' });
  assert.deepEqual(route.primary, { provider: 'openai', model: 'gpt-x', apiKey: 'sk-asistente', keyOwner: 'company' });
  assert.deepEqual(route.fallback, { provider: 'gemini', model: 'gemini-base', apiKey: 'g-asistente', keyOwner: 'company' });
});

test('ruta: sin clave del principal no responde (no hay clave de la plataforma)', async () => {
  const svc = service({ gemini: 'g' });
  await assert.rejects(svc.route('p', { ...toSettings(null), llmProvider: 'openai' }), MissingModelKeyError);
  await assert.rejects(service({}).route('p', toSettings(null)), /no tiene clave de Gemini/);
});

test('ruta: respaldo sin clave, igual al principal o "none" se omite', async () => {
  const svc = service({ gemini: 'g' });
  assert.equal((await svc.route('p', { ...toSettings(null), llmFallback: 'groq' })).fallback, null);
  assert.equal((await svc.route('p', { ...toSettings(null), llmFallback: 'gemini' })).fallback, null);
  assert.equal((await svc.route('p', { ...toSettings(null), llmFallback: 'none' })).fallback, null);
});

test('cacheModelKey conserva el formato anterior para Gemini', () => {
  assert.equal(cacheModelKey({ provider: 'gemini', model: 'gemini-3.5-flash' }), 'gemini-3.5-flash');
  assert.equal(cacheModelKey({ provider: 'openai', model: 'gpt-5.4-mini' }), 'openai:gpt-5.4-mini');
});

test('Mistral usa su modelo por defecto con la clave del asistente', async () => {
  const route = await service({ mistral: 'm-key' }).route('p', { ...toSettings(null), llmProvider: 'mistral' });
  assert.deepEqual(route.primary, { provider: 'mistral', model: 'mistral-base', apiKey: 'm-key', keyOwner: 'company' });
});
