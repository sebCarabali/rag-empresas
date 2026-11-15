import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ReindexService } from './reindex.service';
import type { AnswerCache, ChunkRepository, EmbeddedChunk, ProjectRepository, ReindexState, StoredChunk } from '../ports';

/** Repositorios falsos en memoria: lo justo para fragmentos, proyecto y caché. */
function fakeStore(chunkCount: number) {
  const chunks = Array.from({ length: chunkCount }, (_, i) => ({
    id: String(i).padStart(4, '0'),
    document_id: 'd',
    project_id: 'p',
    company_id: 'c',
    chunk_index: i,
    content: `texto ${i}`,
    metadata: {},
    embedding: null as number[] | null,
    embedding_model: null as string | null,
  }));
  const state: ReindexState = { embeddingModel: 'viejo', status: null, done: 0, total: 0, startedAt: null, finishedAt: null, error: null };
  const calls: string[] = [];

  const projects = {
    reindexState: async () => ({ ...state }),
    claimReindex: async (_id: string, total: number) => {
      if (state.status === 'running') return false;
      Object.assign(state, { status: 'running', done: 0, total });
      return true;
    },
    saveReindexProgress: async (_id: string, done: number) => void (state.done = done),
    finishReindex: async (_id: string, model: string, done: number) => void Object.assign(state, { embeddingModel: model, status: 'done', done }),
    failReindex: async (_id: string, error: string) => void Object.assign(state, { status: 'failed', error }),
  } as unknown as ProjectRepository;

  const chunkRepo = {
    count: async () => chunks.length,
    page: async (_p: string, after: string | undefined, limit: number): Promise<StoredChunk[]> =>
      chunks.filter((c) => !after || c.id > after).slice(0, limit).map(({ embedding: _e, embedding_model: _m, ...r }) => r),
    saveEmbeddings: async (rows: EmbeddedChunk<StoredChunk>[]) => {
      for (const r of rows) Object.assign(chunks.find((c) => c.id === r.chunk.id)!, { embedding: r.embedding, embedding_model: r.model });
    },
  } as unknown as ChunkRepository;

  const cache = { forgetEmbeddings: async () => void calls.push('cache:forget') } as unknown as AnswerCache;
  return { projects, chunkRepo, cache, chunks, state, calls };
}

const embedCalls: unknown[] = [];
const embeddings = {
  embedPassages: async (t: string[], opts: unknown) => {
    embedCalls.push(opts);
    return t.map(() => [0.5, 0.5]);
  },
} as never;
const models = { embeddingModel: async () => 'nuevo', invalidate: () => undefined } as never;

test('reindexa todos los fragmentos y marca el proyecto con el modelo nuevo', async () => {
  const db = fakeStore(150);
  const svc = new ReindexService(db.projects, db.chunkRepo, db.cache, embeddings, models);
  const jobs: unknown[] = [];
  svc.requester = async (job) => void jobs.push(job);

  assert.equal((await svc.status('p')).outdated, true);
  assert.equal(await svc.start('p'), true);
  assert.equal(await svc.start('p'), false, 'no arranca dos veces');
  assert.deepEqual(jobs, [{ kind: 'reembed', projectId: 'p', model: 'nuevo' }]);

  const result = await svc.run({ kind: 'reembed', projectId: 'p', model: 'nuevo' });
  assert.equal(result.next, undefined);
  assert.ok(db.chunks.every((c) => c.embedding?.join() === '0.5,0.5' && c.embedding_model === 'nuevo'));
  assert.deepEqual(embedCalls[0], { model: 'nuevo', projectId: 'p' });
  assert.equal(db.state.embeddingModel, 'nuevo');
  assert.equal(db.state.status, 'done');
  assert.equal(db.state.done, 150);
  assert.ok(db.calls.includes('cache:forget'), 'quita los embeddings de la caché');
  assert.equal((await svc.status('p')).outdated, false);
});

test('abandona un trabajo de otro modelo', async () => {
  const db = fakeStore(3);
  const svc = new ReindexService(db.projects, db.chunkRepo, db.cache, embeddings, models);
  await svc.run({ kind: 'reembed', projectId: 'p', model: 'viejo' });
  assert.ok(db.chunks.every((c) => c.embedding === null));
});
