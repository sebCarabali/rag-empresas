import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { evaluateAnswer, normalizeForMatch } from './evaluate';

test('normaliza tildes, mayúsculas, Markdown y separadores numéricos', () => {
  assert.equal(normalizeForMatch('**Poliéster**  1.234 telas, 1,5 m'), 'poliester 1234 telas, 1.5 m');
  assert.equal(normalizeForMatch('722'), normalizeForMatch('722'));
});

test('aprueba si contiene lo esperado y nada prohibido', () => {
  const r = evaluateAnswer('Hay **1.234** telas de algodon en 160 cm.', ['1234', 'Algodón'], ['no existe']);
  assert.deepEqual(r, { passed: true, missing: [], forbidden: [] });
});

test('reprueba con faltantes, prohibidos o respuesta vacía', () => {
  const r = evaluateAnswer('No existe esa tela.', ['lino'], ['no existe']);
  assert.equal(r.passed, false);
  assert.deepEqual(r.missing, ['lino']);
  assert.deepEqual(r.forbidden, ['no existe']);
  assert.equal(evaluateAnswer('  ', [], []).passed, false);
});
