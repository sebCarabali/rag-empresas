import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { orderByScores, RerankerService } from './reranker.service';

const config = (over: Record<string, unknown> = {}) =>
  ({ reranker: { enabled: true, timeoutMs: 200, ...over } }) as never;

const chunks = [
  { id: 'a', content: 'Horario de atención de lunes a viernes' },
  { id: 'b', content: 'Tela de algodón 100% para niños, 3 colores' },
  { id: 'c', content: 'Política de devoluciones' },
];

test('orderByScores ordena por puntuación y conserva el orden en empates', () => {
  const out = orderByScores([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], [0.1, 0.9, 0.1, Number.NaN]);
  assert.deepEqual(
    out.map((o) => o.id),
    [2, 1, 3, 4],
  );
  assert.equal(out[0].rerank_score, 0.9);
});

test('reordena los candidatos según el modelo', async () => {
  const svc = new RerankerService(config());
  svc.scorerOverride = async (_q, passages) => passages.map((p) => (p.includes('algodón') ? 5 : p.includes('devol') ? 1 : -2));
  const r = await svc.rerank('¿Qué telas de algodón hay?', chunks);
  assert.equal(r.reranked, true);
  assert.deepEqual(
    r.items.map((c) => c.id),
    ['b', 'c', 'a'],
  );
});

test('procesa en lotes y conserva la correspondencia', async () => {
  const svc = new RerankerService(config());
  const calls: number[] = [];
  svc.scorerOverride = async (_q, passages) => {
    calls.push(passages.length);
    return passages.map((p) => Number(p));
  };
  const many = Array.from({ length: 23 }, (_, i) => ({ content: String(i) }));
  const r = await svc.rerank('q', many);
  assert.deepEqual(calls, [10, 10, 3]);
  assert.equal(r.items[0].content, '22');
  assert.equal(r.items.at(-1)!.content, '0');
});

test('si falla o tarda demasiado, devuelve el orden original', async () => {
  const failing = new RerankerService(config());
  failing.scorerOverride = async () => {
    throw new Error('sin modelo');
  };
  const r1 = await failing.rerank('q', chunks);
  assert.equal(r1.reranked, false);
  assert.deepEqual(r1.items, chunks);

  const slow = new RerankerService(config({ timeoutMs: 20 }));
  slow.scorerOverride = () => new Promise((resolve) => setTimeout(() => resolve([1, 2, 3]), 200));
  const r2 = await slow.rerank('q', chunks);
  assert.equal(r2.reranked, false);
  assert.deepEqual(r2.items, chunks);
});

test('desactivado no llama al modelo', async () => {
  const svc = new RerankerService(config({ enabled: false }));
  svc.scorerOverride = async () => assert.fail('no debe llamarse');
  const r = await svc.rerank('q', chunks);
  assert.equal(r.reranked, false);
});
