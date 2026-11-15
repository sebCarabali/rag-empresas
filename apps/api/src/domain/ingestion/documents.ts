/** Tipos de archivo y secciones de texto: conocimiento del dominio de la ingesta. */

export interface TextSection {
  text: string;
  /** Número de página (PDF), si aplica. */
  page?: number;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const SUPPORTED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (.docx)',
  [XLSX_MIME]: 'Excel (.xlsx)',
  'text/plain': 'Texto',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'image/png': 'Imagen PNG',
  'image/jpeg': 'Imagen JPG',
  'image/webp': 'Imagen WebP',
};

/** Tablas: se procesan por filas (un fragmento por producto) y llenan el catálogo. */
export const TABULAR_MIME_TYPES = new Set(['text/csv', XLSX_MIME]);

export class UnsupportedFileError extends Error {}
