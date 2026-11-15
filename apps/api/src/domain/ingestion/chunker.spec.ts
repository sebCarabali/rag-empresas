import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chunkSections } from './chunker';

test('texto corto produce un solo fragmento', () => {
  const chunks = chunkSections([{ text: 'Hola mundo, esto es una prueba.', page: 1 }]);
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0].metadata, { page: 1 });
});

test('texto largo se divide respetando el tamaño máximo', () => {
  const paragraph = 'La empresa ofrece quince días de vacaciones al año. '.repeat(20);
  const text = Array.from({ length: 10 }, () => paragraph).join('\n\n');
  const chunks = chunkSections([{ text }], { chunkSize: 500, overlap: 100 });
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(c.content.length <= 600, `fragmento de ${c.content.length}`);
});

test('fragmentos consecutivos se solapan', () => {
  const text = Array.from({ length: 60 }, (_, i) => `Oración número ${i} del documento.`).join(' ');
  const chunks = chunkSections([{ text }], { chunkSize: 300, overlap: 80 });
  assert.ok(chunks.length > 2);
  const endOfFirst = chunks[0].content.slice(-30);
  assert.ok(chunks[1].content.includes(endOfFirst.slice(endOfFirst.indexOf(' ') + 1)));
});

test('ignora secciones vacías y basura', () => {
  const chunks = chunkSections([{ text: '   ' }, { text: '12' }, { text: 'Contenido real' }]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].content, 'Contenido real');
});
