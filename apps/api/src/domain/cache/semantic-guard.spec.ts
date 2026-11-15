import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildVocabulary, numbers, sameIntent, singular } from './semantic-guard';

// Vocabulario sintético con la forma del de un catálogo de telas.
const vocab = buildVocabulary(['algodón', 'poliéster', 'popelina', 'rígida', 'kidteks', 'lino', 'tela', '100', 'elastano']);

test('singular aproximado', () => {
  assert.equal(singular('algodones'), 'algodon');
  assert.equal(singular('telas'), 'tela');
  assert.equal(singular('lino'), 'lino');
});

test('cifras normalizadas', () => {
  assert.deepEqual(numbers('menos de 1.200 g y 1,5 m'), ['1.5', '1200']);
});

test('reutiliza paráfrasis con los mismos términos del catálogo', () => {
  assert.ok(sameIntent('¿Qué algodones tienen para bebés?', 'telas de algodón para niños', vocab));
  assert.ok(sameIntent('¿Qué telas de algodón 100% hay para niños?', 'algodón 100% para niños, ¿qué hay?', vocab));
});

test('no reutiliza si cambia un término del catálogo o una cifra', () => {
  assert.equal(sameIntent('telas de poliéster para niños', 'telas de algodón para niños', vocab), false);
  assert.equal(sameIntent('dame información de la popelina rígida', 'dame información de la popelina', vocab), false);
  assert.equal(sameIntent('telas de menos de 150 g/m²', 'telas de menos de 120 g/m²', vocab), false);
  assert.equal(sameIntent('¿Qué telas de algodón 100% hay?', '¿Qué telas de algodón hay?', vocab), false);
});
