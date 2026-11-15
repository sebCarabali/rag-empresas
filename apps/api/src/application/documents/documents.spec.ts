import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DocumentsService, safeFileName } from './documents.service';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../domain/errors';
import { SYSTEM_SCOPE, type DocumentFile } from '../ports';

function setup(opts: { doc?: Partial<DocumentFile> | null; editor?: boolean; fileExists?: boolean; uploadFails?: boolean } = {}) {
  const log: string[] = [];
  const doc =
    opts.doc === null ? null : { id: 'd1', company_id: 'c1', project_id: 'p1', name: 'a.pdf', storage_path: 'c1/p1/d1/a.pdf', mime_type: 'application/pdf', status: 'ready', ...opts.doc };
  const documents = {
    find: async () => doc,
    create: async (_s: unknown, input: { id: string; storagePath: string }) => (log.push(`create:${input.storagePath}`), { id: input.id }),
    delete: async (_s: unknown, id: string) => (log.push(`delete:${id}`), { storagePath: 'c1/p1/d1/a.pdf' }),
    markQueued: async (id: string) => (log.push(`queued:${id}`), { id, status: 'pending' }),
  };
  const files = {
    exists: async () => opts.fileExists ?? true,
    remove: async (paths: string[]) => void log.push(`remove:${paths.join(',')}`),
    createSignedUpload: async (_s: unknown, path: string) => {
      if (opts.uploadFails) throw new ForbiddenError('sin permiso');
      return { path, token: 't', signedUrl: 'https://u' };
    },
  };
  const queue = { enqueue: async (job: unknown) => void log.push(`enqueue:${JSON.stringify(job)}`) };
  const projects = { ref: async (_s: unknown, id: string) => ({ id, companyId: 'c1' }) };
  const access = { hasRole: async () => opts.editor ?? true };
  const svc = new DocumentsService(documents as never, files as never, queue as never, projects as never, access as never);
  return { svc, log };
}

test('safeFileName quita acentos y caracteres raros', () => {
  assert.equal(safeFileName('Catálogo de telas (2026).pdf'), 'Catalogo_de_telas_2026_.pdf');
  assert.equal(safeFileName('###'), '_');
});

test('create: registra el documento en la carpeta de la empresa y el proyecto', async () => {
  const { svc, log } = setup();
  const out = await svc.create(SYSTEM_SCOPE, 'p1', { fileName: 'precios.csv', mimeType: 'text/csv', sizeBytes: 10 });
  assert.match(log[0], /^create:c1\/p1\/[0-9a-f-]{36}\/precios\.csv$/);
  assert.equal(out.upload.signedUrl, 'https://u');
});

test('create: si no se puede preparar la subida, borra el registro', async () => {
  const { svc, log } = setup({ uploadFails: true });
  await assert.rejects(svc.create(SYSTEM_SCOPE, 'p1', { fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1 }), ForbiddenError);
  assert.ok(log.some((l) => l.startsWith('delete:')));
});

test('process: encola el documento', async () => {
  const { svc, log } = setup();
  await svc.process(SYSTEM_SCOPE, 'd1');
  assert.deepEqual(log, ['queued:d1', 'enqueue:{"documentId":"d1","startChunk":0}']);
});

test('process: valida existencia, rol, estado y archivo', async () => {
  await assert.rejects(setup({ doc: null }).svc.process(SYSTEM_SCOPE, 'd1'), NotFoundError);
  await assert.rejects(setup({ editor: false }).svc.process(SYSTEM_SCOPE, 'd1'), ForbiddenError);
  await assert.rejects(setup({ doc: { status: 'processing' } }).svc.process(SYSTEM_SCOPE, 'd1'), ConflictError);
  await assert.rejects(setup({ fileExists: false }).svc.process(SYSTEM_SCOPE, 'd1'), InvalidInputError);
});

test('remove: borra el archivo y su transcripción OCR', async () => {
  const { svc, log } = setup();
  await svc.remove(SYSTEM_SCOPE, 'd1');
  assert.deepEqual(log, ['delete:d1', 'remove:c1/p1/d1/a.pdf,c1/p1/d1/a.pdf.ocr.json']);
});
