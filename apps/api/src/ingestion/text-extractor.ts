export interface TextSection {
  text: string;
  /** Número de página (PDF), si aplica. */
  page?: number;
}

export const SUPPORTED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (.docx)',
  'text/plain': 'Texto',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
};

export class UnsupportedFileError extends Error {}

/** Extrae el texto de un archivo, separado por página cuando el formato lo permite. */
export async function extractText(buffer: Buffer, mimeType: string): Promise<TextSection[]> {
  switch (mimeType) {
    case 'application/pdf': {
      const { extractText: extractPdf, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractPdf(pdf, { mergePages: false });
      return text.map((pageText, i) => ({ text: pageText, page: i + 1 }));
    }
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
