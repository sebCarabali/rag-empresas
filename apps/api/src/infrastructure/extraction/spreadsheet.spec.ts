import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { spreadsheetToTable } from './spreadsheet';

// Archivo sintético generado para las pruebas (no contiene datos reales).
const FIXTURE = join(__dirname, '..', '..', '..', 'test-fixtures', 'catalogo-sintetico.xlsx');

test('Excel: un fragmento por fila, con el nombre de la hoja tras el título', async () => {
  const { chunks, items } = await spreadsheetToTable(readFileSync(FIXTURE));
  assert.equal(chunks.length, 3);
  const lino = chunks.find((c) => c.content.includes('Lino Demo'));
  assert.ok(lino);
  const lines = lino.content.split('\n');
  assert.match(lines[0], /Lino Demo/);
  assert.equal(lines[1], 'Hoja: Telas');
  assert.match(lino.content, /150/);
  const boton = chunks.find((c) => c.content.includes('Botón Demo'));
  assert.match(boton!.content, /2026-01-15/);
  assert.equal(items.length, 3);
});
