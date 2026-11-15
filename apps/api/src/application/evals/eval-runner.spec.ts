import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EvalRunnerService } from './eval-runner.service';
import type { EvalResultInput } from '../ports';

test('ejecuta las preguntas pendientes y cierra la ejecución', async () => {
  const saved: EvalResultInput[] = [];
  const state = { status: 'queued' };
  const evals = {
    findRun: async () => ({ id: 'r1', company_id: 'c1', project_id: 'p1', status: state.status }),
    markRunning: async () => void (state.status = 'running'),
    casesForProject: async () => [
      { id: 'a', question: '¿Hay lino?', must_include: ['lino'], must_not_include: [] },
      { id: 'b', question: '¿Precio?', must_include: ['$'], must_not_include: ['no sé'] },
      { id: 'ya', question: 'hecha', must_include: [], must_not_include: [] },
    ],
    completedCaseIds: async () => new Set(['ya']),
    saveResult: async (r: EvalResultInput) => void saved.push(r),
    finishRun: async () => ({ passed: 1, total: 3 }),
  };
  const engine = {
    ask: async (input: { question: string; useCache?: boolean; scope: unknown }) => {
      assert.equal(input.useCache, false);
      assert.deepEqual(input.scope, { kind: 'system' });
      return { answer: input.question.includes('lino') ? 'Sí, lino.' : 'No sé.', modelInfo: null };
    },
  };
  const chatbots = { findByProject: async () => null, profile: () => null };
  const svc = new EvalRunnerService(evals as never, engine as never, chatbots as never);

  assert.deepEqual(await svc.run({ kind: 'eval', runId: 'r1' }), {});
  assert.equal(state.status, 'running');
  assert.deepEqual(saved.map((r) => [r.caseId, r.passed]), [['a', true], ['b', false]]);
  assert.deepEqual(saved[1].forbidden, ['no sé']);
});
