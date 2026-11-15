import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cacheModelKey, ModelSettingsService, toSettings } from './model-settings.service';

const config = {
  geminiModel: 'gemini-base',
  groqModel: 'groq-base',
  openaiModel: 'openai-base',
  embeddingModel: 'Xenova/multilingual-e5-base',
  llmFallback: true,
} as never;

function service(companyKeys: Record<string, string>, platform: Record<string, string>) {
  const keys = {
    getKey: async (_c: string, p: string) => companyKeys[p] ?? null,
    platformKey: (p: string) => platform[p] ?? '',
  };
  return new ModelSettingsService({} as never, keys as never, config);
}

test('toSettings usa los valores por defecto sin fila', () => {
  assert.deepEqual(toSettings(null), {
    llmProvider: 'gemini',
    llmModel: null,
    llmFallback: 'groq',
    llmFallbackModel: null,
    embeddingModel: null,
  });
});

test('ruta: clave de la empresa para el principal y de la plataforma para el respaldo', async () => {
  const svc = service({ openai: 'sk-empresa' }, { gemini: 'g', groq: 'q' });
  const route = await svc.route('c', { ...toSettings(null), llmProvider: 'openai', llmModel: 'gpt-x', llmFallback: 'gemini' });
  assert.deepEqual(route.primary, { provider: 'openai', model: 'gpt-x', apiKey: 'sk-empresa', keyOwner: 'company' });
  assert.deepEqual(route.fallback, { provider: 'gemini', model: 'gemini-base', apiKey: 'g', keyOwner: 'platform' });
});

test('ruta: sin clave del proveedor elegido se usa Gemini; respaldo igual al principal se omite', async () => {
  const svc = service({}, { gemini: 'g' });
  const route = await svc.route('c', { ...toSettings(null), llmProvider: 'openai', llmFallback: 'gemini' });
  assert.equal(route.primary.provider, 'gemini');
  assert.equal(route.fallback, null);
});

test('respaldo "none" no agrega modelo de respaldo', async () => {
  const svc = service({}, { gemini: 'g', groq: 'q' });
  const route = await svc.route('c', { ...toSettings(null), llmFallback: 'none' });
  assert.equal(route.fallback, null);
});

test('cacheModelKey conserva el formato anterior para Gemini', () => {
  assert.equal(cacheModelKey({ provider: 'gemini', model: 'gemini-3.5-flash' }), 'gemini-3.5-flash');
  assert.equal(cacheModelKey({ provider: 'openai', model: 'gpt-5.4-mini' }), 'openai:gpt-5.4-mini');
});
