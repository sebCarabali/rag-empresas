import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { splitOcrPages } from './ocr.service';

test('OCR: separa la transcripción por los marcadores de página', () => {
  const text = '=== Página 1 ===\nHola\n\n=== Pagina 2 ===\n\n=== Página 3 ===\nFin | 2';
  assert.deepEqual(splitOcrPages(text), [
    { text: 'Hola', page: 1 },
    { text: 'Fin | 2', page: 3 },
  ]);
});

test('OCR: sin marcadores devuelve una sola sección', () => {
  assert.deepEqual(splitOcrPages('  texto de una imagen '), [{ text: 'texto de una imagen' }]);
  assert.deepEqual(splitOcrPages('   '), []);
});
