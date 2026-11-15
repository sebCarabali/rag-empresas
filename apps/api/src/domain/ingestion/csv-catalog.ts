import type { Chunk } from './chunker';

/**
 * Convierte un CSV en fragmentos listos para vectorizar: un fragmento por
 * producto (o por grupo de variantes idénticas), con texto limpio en vez de
 * la fila cruda. Soporta:
 *  - Exportaciones de WooCommerce (columnas "Nombre del atributo N" / "Valor(es) del atributo N"),
 *    aunque la fila de encabezado no esté al principio.
 *  - CSV genéricos con encabezado ("Columna: valor" por línea).
 *  - CSV sin encabezado (celdas útiles unidas).
 */

export interface CsvChunkOptions {
  /** Máximo de códigos de variantes en un mismo fragmento. */
  maxCodesPerChunk?: number;
}

export type Row = string[];

/* ------------------------------------------------------------------ */
/* Lectura                                                              */
/* ------------------------------------------------------------------ */

/** Decodifica UTF-8 (con o sin BOM); si hay caracteres inválidos, prueba Windows-1252 (Excel). */
export function decodeCsv(buffer: Buffer): string {
  let text = buffer.toString('utf8');
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer);
  return text.replace(/^﻿/, '');
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/, 20).join('\n');
  const candidates = [';', ',', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const c of candidates) {
    const count = sample.split(c).length - 1;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

/** Parser RFC 4180: comillas dobles, delimitadores y saltos de línea dentro de campos. */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): Row[] {
  const rows: Row[] = [];
  let row: Row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/* ------------------------------------------------------------------ */
/* Limpieza de valores                                                  */
/* ------------------------------------------------------------------ */

/** Abreviaturas textiles frecuentes en composiciones. */
const FIBERS: Record<string, string> = {
  alg: 'Algodón',
  pol: 'Poliéster',
  spa: 'Spandex',
  vis: 'Viscosa',
  nyl: 'Nylon',
  lin: 'Lino',
  poliu: 'Poliuretano',
  lur: 'Lurex',
  ray: 'Rayón',
  lan: 'Lana',
  sed: 'Seda',
  acr: 'Acrílico',
  ela: 'Elastano',
  mod: 'Modal',
  ten: 'Tencel',
};

const UNITS: Record<string, string> = { m: 'metro', mt: 'metro', mts: 'metros', kg: 'kilogramo', yd: 'yarda' };

const EMPTY_VALUES = new Set(['', '-', '--', 'n/a', 'na', 'null', 'none']);

function clean(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function isEmpty(value: string): boolean {
  return EMPTY_VALUES.has(value.toLowerCase());
}

/** "Pol 65%-Alg 35%" → "Poliéster 65%, Algodón 35%" */
export function expandComposition(value: string): string {
  return value
    .split(/\s*[-/+,]\s*(?=[A-Za-zÁÉÍÓÚáéíóúñÑ])/)
    .map((part) =>
      part.replace(/^([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\.?/, (abbr: string) => FIBERS[abbr.toLowerCase()] ?? abbr),
    )
    .join(', ');
}

/** "150 cm. +/- 3%" → "150 cm (±3%)"; "360 gr/m2." → "360 g/m²" */
export function normalizeMeasure(value: string): string {
  let v = value
    .replace(/\bgr\s*\/\s*m2\.?/gi, 'g/m²')
    .replace(/\b(cm|mm|kg|gr|mts?)\.(?=\s|$)/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  v = v.replace(/\s*\+\/-\s*(\d+(?:[.,]\d+)?\s*%)$/, ' (±$1)');
  return v;
}

/** "TIPO DE TEJIDO" → "Tipo de tejido"; respeta valores ya en mayúsculas/minúsculas mixtas. */
function sentenceCase(label: string): string {
  const l = clean(label);
  if (l !== l.toUpperCase()) return l;
  const lower = l.toLocaleLowerCase('es');
  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
}

function formatValue(label: string, value: string): string {
  const name = label.toLowerCase();
  if (/composici|composition/.test(name)) return expandComposition(value);
  if (/unidad|unit/.test(name)) return UNITS[value.toLowerCase()] ?? value;
  return normalizeMeasure(value);
}

/* ------------------------------------------------------------------ */
/* Detección de formato                                                 */
/* ------------------------------------------------------------------ */

const WOO_NAME_ATTR = /^(nombre del atributo|attribute) (\d+)( name)?$/i;
const WOO_VALUE_ATTR = /^(valor\(es\) del atributo|attribute) (\d+)( value\(s\))?$/i;

function normHeader(h: string): string {
  return clean(h)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function isWooHeader(row: Row): boolean {
  return row.some((c) => WOO_NAME_ATTR.test(clean(c))) && row.some((c) => /^sku$/i.test(clean(c)));
}

/** Un encabezado genérico: sin números, sin URLs y con nombres únicos. */
function looksLikeHeader(row: Row): boolean {
  const cells = row.map(clean).filter(Boolean);
  if (cells.length < 2) return false;
  if (new Set(cells).size !== cells.length) return false;
  return cells.every((c) => !/^[\d.,%\s-]+$/.test(c) && !/^https?:\/\//.test(c));
}

/* ------------------------------------------------------------------ */
/* Construcción de fragmentos                                           */
/* ------------------------------------------------------------------ */

interface ProductRecord {
  title: string;
  codes: string[];
  images: string[];
  lines: string[];
  /** Atributos ya formateados, para la tabla del catálogo. */
  attrs: Record<string, string>;
  row: number;
}

/** Fila del catálogo estructurado (un producto, sin agrupar variantes). */
export interface CatalogItem {
  row: number;
  name: string;
  code: string | null;
  attributes: Record<string, string>;
  /** Número inicial de cada atributo ("145 g/m² (±7%)" → 145), para filtros y orden. */
  numbers: Record<string, number>;
  image: string | null;
}

function addLine(
  lines: string[],
  seen: Set<string>,
  label: string,
  value: string,
  attrs?: Record<string, string>,
) {
  const v = clean(value);
  if (isEmpty(v)) return;
  const l = sentenceCase(label);
  const key = `${normHeader(l)}=${normHeader(v)}`;
  if (seen.has(key)) return;
  seen.add(key);
  const formatted = formatValue(l, v);
  lines.push(`${l}: ${formatted}`);
  if (attrs && !(l in attrs)) attrs[l] = formatted;
}

/** Número al inicio del valor: "150 cm (±3%)" → 150; "3,3 m/kg" → 3.3; "Algodón 100%" → null. */
export function leadingNumber(value: string): number | null {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(value);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function wooRecords(rows: Row[], headerIndex: number): ProductRecord[] {
  const header = rows[headerIndex].map(clean);
  const col = (...names: string[]) => header.findIndex((h) => names.includes(normHeader(h)));

  const nameCol = col('nombre', 'name');
  const shortCol = col('descripcion corta', 'short description');
  const descCol = col('descripcion', 'description');
  const catCol = col('categorias', 'categories');
  const tagsCol = col('etiquetas', 'tags');
  const imgCol = col('imagenes', 'images');
  const priceCol = col('precio normal', 'regular price');
  const saleCol = col('precio rebajado', 'sale price');
  const typeCol = col('tipo', 'type');

  const attrPairs: Array<[number, number]> = [];
  header.forEach((h, i) => {
    const m = WOO_NAME_ATTR.exec(h);
    if (!m) return;
    const valueIdx = header.findIndex((v) => {
      const mv = WOO_VALUE_ATTR.exec(v);
      return mv !== null && mv[2] === m[2];
    });
    if (valueIdx >= 0) attrPairs.push([i, valueIdx]);
  });

  const records: ProductRecord[] = [];
  rows.forEach((r, idx) => {
    if (idx === headerIndex) return;
    if (isWooHeader(r)) return; // encabezados repetidos
    const type = clean(r[typeCol]).toLowerCase();
    if (type === 'variable') return; // el padre no aporta datos propios; las variaciones sí

    const name = clean(r[nameCol]);
    const short = clean(r[shortCol]);
    const lines: string[] = [];
    const attrs: Record<string, string> = {};
    const seen = new Set<string>();

    for (const [ni, vi] of attrPairs) {
      const label = clean(r[ni]);
      if (label) addLine(lines, seen, label, r[vi], attrs);
    }
    if (catCol >= 0 && !lines.some((l) => /^categor/i.test(l))) {
      addLine(lines, seen, 'Categoría', clean(r[catCol]).replace(/\s*>\s*/g, ' › '), attrs);
    }
    if (tagsCol >= 0) addLine(lines, seen, 'Etiquetas', r[tagsCol], attrs);
    if (priceCol >= 0) addLine(lines, seen, 'Precio', r[priceCol], attrs);
    if (saleCol >= 0) addLine(lines, seen, 'Precio rebajado', r[saleCol], attrs);
    if (descCol >= 0) addLine(lines, seen, 'Descripción', r[descCol].replace(/<[^>]+>/g, ' '), attrs);

    records.push({
      title: short || name || `Fila ${idx + 1}`,
      codes: name ? [name] : [],
      images: clean(r[imgCol])
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^https?:\/\//.test(s)),
      lines,
      attrs,
      row: idx + 1,
    });
  });
  return records;
}

function genericRecords(rows: Row[], hasHeader: boolean): ProductRecord[] {
  const header = hasHeader ? rows[0].map(clean) : [];
  const body = hasHeader ? rows.slice(1) : rows;

  // Columnas que solo contienen valores booleanos/flags (0/1, sí/no) no aportan significado.
  const width = Math.max(...body.map((r) => r.length));
  const flagColumn = Array.from({ length: width }, (_, i) =>
    body.every((r) => /^(|0|1|true|false|si|sí|no|yes|y|n)$/i.test(clean(r[i]))),
  );

  return body.map((r, idx) => {
    const lines: string[] = [];
    const attrs: Record<string, string> = {};
    const seen = new Set<string>();
    const images: string[] = [];
    r.forEach((cell, i) => {
      const v = clean(cell);
      if (flagColumn[i] || isEmpty(v)) return;
      if (/^https?:\/\//.test(v)) {
        if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(v)) images.push(v);
        return;
      }
      if (hasHeader && header[i]) addLine(lines, seen, header[i], v, attrs);
      else lines.push(v);
    });
    // El título es el primer valor; no se repite como "Columna: valor".
    const title = hasHeader ? (lines[0]?.split(': ').slice(1).join(': ') ?? '') : (lines[0] ?? '');
    const body = hasHeader ? lines.slice(1) : [lines.join(' | ')];
    return {
      title: title || `Fila ${idx + 1}`,
      codes: [],
      images,
      lines: body.length > 0 ? body : lines,
      attrs: hasHeader ? attrs : {},
      row: idx + (hasHeader ? 2 : 1),
    };
  });
}

/** Agrupa productos con exactamente los mismos atributos (variantes que solo cambian de código). */
function groupVariants(records: ProductRecord[], maxCodes: number): ProductRecord[] {
  const groups = new Map<string, ProductRecord>();
  const out: ProductRecord[] = [];
  for (const rec of records) {
    if (rec.codes.length === 0) {
      out.push(rec);
      continue;
    }
    const key = `${rec.title}\n${rec.lines.join('\n')}`;
    const existing = groups.get(key);
    if (existing && existing.codes.length < maxCodes) {
      existing.codes.push(...rec.codes);
      if (existing.images.length < 3) existing.images.push(...rec.images.slice(0, 3 - existing.images.length));
    } else {
      const copy = { ...rec, codes: [...rec.codes], images: rec.images.slice(0, 3) };
      groups.set(key, copy);
      out.push(copy);
    }
  }
  return out;
}

function toChunk(rec: ProductRecord): Chunk {
  const header = [rec.title];
  if (rec.codes.length === 1) header.push(`Código: ${rec.codes[0]}`);
  if (rec.codes.length > 1) header.push(`Códigos (${rec.codes.length} variantes): ${rec.codes.join(', ')}`);
  return {
    content: [...header, ...rec.lines].join('\n'),
    metadata: {
      format: 'csv',
      row: rec.row,
      ...(rec.codes.length ? { codes: rec.codes } : {}),
      ...(rec.images.length ? { images: rec.images } : {}),
    },
  };
}

/** Filas de una tabla (CSV o una hoja de Excel) → productos. */
function rowsToRecords(input: Row[]): ProductRecord[] {
  const rows = input.filter((r) => r.some((c) => clean(c) !== ''));
  if (rows.length === 0) return [];
  const wooHeader = rows.findIndex(isWooHeader);
  const records =
    wooHeader >= 0
      ? wooRecords(rows, wooHeader)
      : genericRecords(rows, looksLikeHeader(rows[0]) && rows.length > 1);
  return records.filter((r) => r.lines.length > 0);
}

function readRecords(buffer: Buffer): ProductRecord[] {
  return rowsToRecords(parseDelimited(decodeCsv(buffer)));
}

function recordsToCatalogItems(records: ProductRecord[]): CatalogItem[] {
  return records
    .filter((r) => Object.keys(r.attrs).length > 0)
    .map((r) => {
      const code = r.codes[0] ?? null;
      const attributes: Record<string, string> = { Nombre: r.title, ...(code ? { 'Código': code } : {}), ...r.attrs };
      const numbers: Record<string, number> = {};
      for (const [k, v] of Object.entries(attributes)) {
        const n = leadingNumber(v);
        if (n !== null) numbers[k] = n;
      }
      return { row: r.row, name: r.title, code, attributes, numbers, image: r.images[0] ?? null };
    });
}

export function csvToChunks(buffer: Buffer, options: CsvChunkOptions = {}): Chunk[] {
  return groupVariants(readRecords(buffer), options.maxCodesPerChunk ?? 40).map(toChunk);
}

/**
 * Productos para la tabla del catálogo: uno por fila (sin agrupar), para que
 * conteos y filtros sean exactos. Vacío si el CSV no tiene encabezado.
 */
export function csvToCatalogItems(buffer: Buffer): CatalogItem[] {
  return recordsToCatalogItems(readRecords(buffer));
}

/** Tabla ya leída (p. ej. una hoja de Excel): fragmentos para el chat. */
export function tableToChunks(rows: Row[], extraMetadata: Record<string, unknown> = {}, options: CsvChunkOptions = {}): Chunk[] {
  return groupVariants(rowsToRecords(rows), options.maxCodesPerChunk ?? 40)
    .map(toChunk)
    .map((c) => ({ ...c, metadata: { ...c.metadata, ...extraMetadata } }));
}

/** Tabla ya leída: productos para el catálogo estructurado. */
export function tableToCatalogItems(rows: Row[]): CatalogItem[] {
  return recordsToCatalogItems(rowsToRecords(rows));
}
