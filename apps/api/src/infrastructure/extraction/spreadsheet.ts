import type { Chunk } from '../../domain/ingestion/chunker';
import { tableToCatalogItems, tableToChunks, type CatalogItem, type Row } from '../../domain/ingestion/csv-catalog';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Convierte el valor de una celda a texto (fechas en AAAA-MM-DD, números tal cual). */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return String(value);
}

export interface SheetTable {
  sheet: string;
  rows: Row[];
}

/** Lee todas las hojas de un .xlsx como tablas de texto. */
export async function readSpreadsheet(buffer: Buffer): Promise<SheetTable[]> {
  const { default: readXlsxFile } = await import('read-excel-file/node');
  const sheets = await readXlsxFile(buffer);
  return sheets.map((s) => ({
    sheet: s.sheet,
    rows: s.data.map((row) => row.map(cellToText)),
  }));
}

/**
 * Excel → fragmentos y productos, con la misma lógica que los CSV (un
 * fragmento por producto, WooCommerce, agrupación de variantes…). Cada hoja se
 * procesa por separado y su nombre queda en la metadata.
 */
export async function spreadsheetToTable(buffer: Buffer): Promise<{ chunks: Chunk[]; items: CatalogItem[] }> {
  const sheets = await readSpreadsheet(buffer);
  const multiple = sheets.filter((s) => s.rows.length > 0).length > 1;
  const chunks: Chunk[] = [];
  const items: CatalogItem[] = [];
  for (const { sheet, rows } of sheets) {
    if (rows.length === 0) continue;
    for (const chunk of tableToChunks(rows, multiple ? { sheet } : {})) {
      if (!multiple) {
        chunks.push(chunk);
        continue;
      }
      // La hoja va después del título: la primera línea identifica al producto (ver diversify).
      const [title, ...rest] = chunk.content.split('\n');
      chunks.push({ ...chunk, content: [title, `Hoja: ${sheet}`, ...rest].join('\n') });
    }
    items.push(...tableToCatalogItems(rows));
  }
  return { chunks, items };
}
