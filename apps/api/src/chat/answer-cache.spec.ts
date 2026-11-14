import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isNegativeAnswer } from './answer-cache.service';

test('detecta respuestas sin información (no se guardan en caché)', () => {
  assert.ok(isNegativeAnswer('En los fragmentos del catálogo no aparecen telas de algodón 100 % para niños.'));
  assert.ok(isNegativeAnswer('En la información proporcionada no aparecen datos sobre telas.'));
  assert.ok(isNegativeAnswer('En los fragmentos consultados no se encontró información sobre la popelina.'));
  assert.ok(isNegativeAnswer('No aparece información en los documentos proporcionados sobre cuál es mi uso.'));
});

test('no confunde respuestas útiles con negativas', () => {
  assert.equal(isNegativeAnswer('En el catálogo existen 166 telas de algodón 100% de la submarca Kidteks.'), false);
  assert.equal(isNegativeAnswer('Para crear un topic en Apache Kafka se usa kafka-topics.sh.'), false);
  assert.equal(
    isNegativeAnswer('Los documentos describen dos clasificaciones de integración: tipos de proyectos y estilos. En el texto no se enumeran los patrones…'),
    false,
  );
});
