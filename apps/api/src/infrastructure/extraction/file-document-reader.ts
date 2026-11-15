import { Injectable } from '@nestjs/common';
import type { DocumentReader, OcrFn } from '../../application/ports';
import { spreadsheetToTable } from './spreadsheet';
import { extractText } from './text-extractor';

/** Adaptador del puerto DocumentReader con las librerías de lectura de archivos. */
@Injectable()
export class FileDocumentReader implements DocumentReader {
  extractText(buffer: Buffer, mimeType: string, ocr?: OcrFn) {
    return extractText(buffer, mimeType, ocr);
  }

  readSpreadsheet(buffer: Buffer) {
    return spreadsheetToTable(buffer);
  }
}
