import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MissingModelKeyError } from '../../domain/llm/llm';
import type { EmbeddingBackend } from '../ports';
import { EmbeddingsService } from './embeddings.service';

function backend(provider: EmbeddingBackend['provider'], needsKey: boolean, dims: number) {
  const calls: Array<{ kind: string; model: string; apiKey: string | null }> = [];
  const b: EmbeddingBackend = {
    provider,
    needsKey,
    embed: async (texts, kind, model, apiKey) => {
      calls.push({ kind, model: model.id, apiKey });
      return texts.map(() => new Array(dims).fill(0.1));
    },
  };
  return { b, calls };
}

const keys = (stored: Record<string, string>) => ({
  requireKey: async (_p: string, provider: string) => {
    if (!stored[provider]) throw new MissingModelKeyError(provider as never);
    return stored[provider];
  },
});

test('elige el backend según el proveedor del modelo (Strategy) y le pasa la clave del asistente', async () => {
  const local = backend('local', false, 768);
  const mistral = backend('mistral', true, 1024);
  const svc = new EmbeddingsService({ embeddingModel: 'Xenova/multilingual-e5-base' } as never, keys({ mistral: 'm-key' }) as never, [
    local.b,
    mistral.b,
  ]);
  await svc.embedQuery('hola');
  assert.deepEqual(local.calls[0], { kind: 'query', model: 'Xenova/multilingual-e5-base', apiKey: null });
  const v = await svc.embedPassages(['a', 'b'], { model: 'mistral-embed', projectId: 'p' });
  assert.equal(v.length, 2);
  assert.deepEqual(mistral.calls[0], { kind: 'passage', model: 'mistral-embed', apiKey: 'm-key' });
});

test('sin clave del proveedor falla con un mensaje claro; dimensiones distintas también fallan', async () => {
  const openai = backend('openai', true, 1536);
  const svc = new EmbeddingsService({ embeddingModel: 'x' } as never, keys({}) as never, [openai.b]);
  await assert.rejects(svc.embedQuery('hola', { model: 'text-embedding-3-small', projectId: 'p' }), MissingModelKeyError);

  const wrong = backend('mistral', true, 10);
  const svc2 = new EmbeddingsService({ embeddingModel: 'x' } as never, keys({ mistral: 'k' }) as never, [wrong.b]);
  await assert.rejects(svc2.embedQuery('hola', { model: 'mistral-embed', projectId: 'p' }), /se esperaban 1024/);
});
