import { UnsupportedFileError, type TextSection } from '../../domain/ingestion/documents';

export { UnsupportedFileError, type TextSection };

/** Si un PDF tiene menos caracteres por página que esto, se considera escaneado y se aplica OCR. */
const MIN_CHARS_PER_PAGE = 50;

/** Reconocimiento de texto para PDF escaneados e imágenes. */
export type OcrFn = (buffer: Buffer, mimeType: string) => Promise<TextSection[]>;


/** Extrae el texto de un archivo, separado por página cuando el formato lo permite. */
export async function extractText(buffer: Buffer, mimeType: string, ocr?: OcrFn): Promise<TextSection[]> {
  switch (mimeType) {
    case 'application/pdf': {
      const { extractText: extractPdf, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractPdf(pdf, { mergePages: false });
      const sections = text.map((pageText, i) => ({ text: pageText, page: i + 1 }));
      // PDF escaneado (imágenes sin capa de texto): se transcribe con OCR.
      const chars = sections.reduce((n, s) => n + s.text.replace(/\s+/g, '').length, 0);
      if (ocr && chars < MIN_CHARS_PER_PAGE * Math.max(1, sections.length)) return ocr(buffer, mimeType);
      return sections;
    }
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
      if (!ocr) throw new UnsupportedFileError('Las imágenes necesitan OCR, que no está disponible');
      return ocr(buffer, mimeType);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer });
      return [{ text: value }];
    }
    case 'text/plain':
    case 'text/markdown':
    case 'text/csv':
      return [{ text: buffer.toString('utf8') }];
    default:
      throw new UnsupportedFileError(`Tipo de archivo no soportado: ${mimeType}`);
  }
}
