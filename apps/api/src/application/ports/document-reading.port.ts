import type { Chunk } from '../../domain/ingestion/chunker';
import type { CatalogItem } from '../../domain/ingestion/csv-catalog';
import type { TextSection } from '../../domain/ingestion/documents';

/** Reconocimiento de texto (OCR) para PDF escaneados e imágenes. */
export type OcrFn = (buffer: Buffer, mimeType: string) => Promise<TextSection[]>;

/** Puerto de salida: lee el texto de un archivo (PDF, Word, texto…) y las tablas de Excel. */
export interface DocumentReader {
  extractText(buffer: Buffer, mimeType: string, ocr?: OcrFn): Promise<TextSection[]>;
  readSpreadsheet(buffer: Buffer): Promise<{ chunks: Chunk[]; items: CatalogItem[] }>;
}

/** Puerto de salida: OCR con un modelo, usando la clave del asistente. */
export interface TextRecognizer {
  transcribe(buffer: Buffer, mimeType: string, apiKey: string, context?: { companyId: string; projectId: string }): Promise<TextSection[]>;
}

export const DOCUMENT_READER = Symbol('DOCUMENT_READER');
export const TEXT_RECOGNIZER = Symbol('TEXT_RECOGNIZER');
