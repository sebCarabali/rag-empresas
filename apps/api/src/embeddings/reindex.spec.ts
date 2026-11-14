import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ReindexService } from './reindex.service';

/** Supabase falso en memoria: lo justo para document_chunks, projects y answer_cache. */
function fakeSupabase(chunkCount: number) {
  const chunks = Array.from({ length: chunkCount }, (_, i) => ({
    id: String(i).padStart(4, '0'),
    document_id: 'd',
    project_id: 'p',
    company_id: 'c',
    chunk_index: i,
    content: `texto ${i}`,
    metadata: {},
    embedding: null as string | null,
  }));
  const project: Record<string, unknown> = { embedding_model: 'viejo', reindex_status: null, reindex_done: 0 };
  const calls: string[] = [];
  const from = (table: string) => {
    const state: { op?: string; values?: Record<string, unknown>; gt?: string; limit?: number } = {};
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    Object.assign(chain, {
      select: () => (state.op ??= 'select', chain),
      eq: ret,
      order: ret,
      or: ret,
      single: ret,
      limit: (n: number) => ((state.limit = n), chain),
      gt: (_c: string, v: string) => ((state.gt = v), chain),
      update: (values: Record<string, unknown>) => ((state.op = 'update'), (state.values = values), chain),
      upsert: async (rows: typeof chunks) => {
        for (const r of rows) Object.assign(chunks.find((c) => c.id === r.id)!, r);
        return { error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        calls.push(`${table}:${state.op}`);
        if (table === 'projects') {
          if (state.op === 'update') Object.assign(project, state.values);
          return resolve({ data: state.op === 'update' ? [{ id: 'p' }] : project, error: null });
        }
        if (table === 'document_chunks') {
          const rows = chunks.filter((c) => !state.gt || c.id > state.gt).slice(0, state.limit ?? 1000);
          return resolve({ data: rows.map(({ embedding: _e, ...r }) => r), count: chunks.length, error: null });
        }
        return resolve({ data: null, error: null });
      },
    });
    return chain;
  };
  return { admin: { from }, chunks, project, calls };
}

const config = { embeddingModel: 'nuevo' } as never;
const embeddings = { embedPassages: async (t: string[]) => t.map(() => [0.5, 0.5]) } as never;

test('reindexa todos los fragmentos y marca el proyecto con el modelo nuevo', async () => {
  const db = fakeSupabase(150);
  const svc = new ReindexService(config, db as never, embeddings);
  const jobs: unknown[] = [];
  svc.requester = async (job) => void jobs.push(job);

  assert.equal((await svc.status('p')).outdated, true);
  assert.equal(await svc.start('p'), true);
  assert.deepEqual(jobs, [{ kind: 'reembed', projectId: 'p', model: 'nuevo' }]);

  const result = await svc.run({ kind: 'reembed', projectId: 'p', model: 'nuevo' });
  assert.equal(result.next, undefined);
  assert.ok(db.chunks.every((c) => c.embedding === '[0.5,0.5]'));
  assert.equal(db.project.embedding_model, 'nuevo');
  assert.equal(db.project.reindex_status, 'done');
  assert.equal(db.project.reindex_done, 150);
  assert.ok(db.calls.includes('answer_cache:update'), 'quita los embeddings de la caché');
});

test('abandona un trabajo de otro modelo', async () => {
  const db = fakeSupabase(3);
  const svc = new ReindexService(config, db as never, embeddings);
  await svc.run({ kind: 'reembed', projectId: 'p', model: 'viejo' });
  assert.ok(db.chunks.every((c) => c.embedding === null));
});
