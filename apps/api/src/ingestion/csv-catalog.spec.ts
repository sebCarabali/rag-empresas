import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { csvToChunks, expandComposition, normalizeMeasure, parseDelimited } from './csv-catalog';

// Datos sintéticos con la forma de una exportación de WooCommerce (no son datos reales).
const WOO_HEADER = [
  'Tipo', 'SKU', 'Nombre', 'Publicado', 'Visibilidad en el catálogo', 'Descripcion Corta',
  'Categorías', 'Imágenes',
  'Nombre del atributo 1', 'Valor(es) del atributo 1', 'Atributo visible 1', 'Atributo global 1',
  'Nombre del atributo 2', 'Valor(es) del atributo 2', 'Atributo visible 2', 'Atributo global 2',
  'Nombre del atributo 3', 'Valor(es) del atributo 3', 'Atributo visible 3', 'Atributo global 3',
  'Nombre del atributo 4', 'Valor(es) del atributo 4', 'Atributo visible 4', 'Atributo global 4',
].join(';');

function wooRow(code: string, name: string, comp: string, peso: string, tema: string) {
  return [
    'SIMPLE', `T_${code}`, code, '1', 'VISIBLE', name, 'DEMO', `https://example.com/${code}.jpg`,
    'COMPOSICIÓN', comp, '1', '1',
    'PESO', peso, '1', '1',
    'TEMA', tema, '1', '1',
    'RENDIMIENTO', '-', '0', '0',
  ].join(';');
}

test('parseDelimited respeta comillas y saltos de línea dentro de campos', () => {
  const rows = parseDelimited('a;"b;c";"d ""e"""\r\n1;"dos\nlíneas";3\n', ';');
  assert.deepEqual(rows, [
    ['a', 'b;c', 'd "e"'],
    ['1', 'dos\nlíneas', '3'],
  ]);
});

test('expande composiciones abreviadas', () => {
  assert.equal(expandComposition('Pol 65%-Alg 35%'), 'Poliéster 65%, Algodón 35%');
  assert.equal(expandComposition('Pol 60%-Alg 33%-Spa 7%'), 'Poliéster 60%, Algodón 33%, Spandex 7%');
  assert.equal(expandComposition('Xyz 100%'), 'Xyz 100%');
});

test('normaliza medidas con tolerancia', () => {
  assert.equal(normalizeMeasure('150 cm. +/- 3%'), '150 cm (±3%)');
  assert.equal(normalizeMeasure('360 gr/m2. +/- 7%'), '360 g/m² (±7%)');
  assert.equal(normalizeMeasure('3,3 m/kg +/- 7%'), '3,3 m/kg (±7%)');
});

test('WooCommerce: un fragmento limpio por producto, aunque el encabezado esté en medio', () => {
  const csv = [
    wooRow('TELA_A1', 'Tela Demo', 'Pol 100%', '120 gr/m2. +/- 7%', 'Floral'),
    WOO_HEADER,
    wooRow('TELA_B1', 'Otra Demo', 'Alg 100%', '150 gr/m2. +/- 7%', 'Rayas'),
  ].join('\r\n');
  const chunks = csvToChunks(Buffer.from('﻿' + csv));
  assert.equal(chunks.length, 2);

  const a = chunks[0].content;
  assert.match(a, /^Tela Demo\nCódigo: TELA_A1/);
  assert.match(a, /Composición: Poliéster 100%/);
  assert.match(a, /Peso: 120 g\/m² \(±7%\)/);
  assert.match(a, /Categoría: DEMO/);
  assert.doesNotMatch(a, /VISIBLE|SIMPLE|https?:|Rendimiento/);
  assert.deepEqual(chunks[0].metadata.images, ['https://example.com/TELA_A1.jpg']);
});

test('WooCommerce: agrupa variantes con los mismos atributos', () => {
  const csv = [
    WOO_HEADER,
    wooRow('DISENO_V1', 'Tela Demo', 'Pol 94%-Spa 6%', '102 gr/m2. +/- 7%', 'Pieles'),
    wooRow('DISENO_V2', 'Tela Demo', 'Pol 94%-Spa 6%', '102 gr/m2. +/- 7%', 'Pieles'),
    wooRow('DISENO_V3', 'Tela Demo', 'Pol 94%-Spa 6%', '102 gr/m2. +/- 7%', 'Floral'),
  ].join('\n');
  const chunks = csvToChunks(Buffer.from(csv));
  assert.equal(chunks.length, 2);
  assert.match(chunks[0].content, /Códigos \(2 variantes\): DISENO_V1, DISENO_V2/);
  assert.deepEqual(chunks[0].metadata.codes, ['DISENO_V1', 'DISENO_V2']);
});

test('CSV genérico con encabezado: "Columna: valor" y sin columnas de flags', () => {
  const csv = 'Producto,Precio,Activo,Foto\nSilla,120,1,https://x.com/a.png\nMesa,300,0,\n';
  const chunks = csvToChunks(Buffer.from(csv));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].content, 'Silla\nProducto: Silla\nPrecio: 120');
  assert.deepEqual(chunks[0].metadata.images, ['https://x.com/a.png']);
});

test('CSV en Windows-1252 (Excel) se decodifica bien', () => {
  const csv = Buffer.from('Nombre;Descripción\nCamión;Pequeño\n', 'latin1');
  const chunks = csvToChunks(csv);
  assert.match(chunks[0].content, /Descripción: Pequeño/);
});
