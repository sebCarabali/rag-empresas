import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { topQuestions } from './cache-warm.service';

test('preguntas frecuentes: agrupa por texto normalizado y exige al menos dos repeticiones', () => {
  const list = topQuestions(
    [
      '¿Qué telas de lino hay?',
      'que telas de LINO hay',
      '¿Qué telas de lino hay?',
      'telas para cortinas blackout',
      'telas para cortinas blackout',
      'hola',
      'hola',
      'una pregunta única de verdad',
    ],
    5,
  );
  assert.deepEqual(list, ['¿Qué telas de lino hay?', 'telas para cortinas blackout']);
});
