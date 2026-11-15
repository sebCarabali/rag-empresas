import type { TextSection } from './documents';

export interface Chunk {
  content: string;
  /** Datos extra que se guardan con el fragmento (página, códigos, imágenes…). */
  metadata: { page?: number; [key: string]: unknown };
}

export interface ChunkOptions {
  /** Tamaño objetivo en caracteres (~1000 caracteres ≈ 250-300 tokens en español). */
  chunkSize?: number;
  /** Caracteres que se repiten entre fragmentos consecutivos para no cortar ideas. */
  overlap?: number;
}

const SEPARATORS = ['\n\n', '\n', '. ', '; ', ', ', ' '];

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Divide recursivamente por el separador más "natural" hasta que cada pieza quepa. */
function split(text: string, chunkSize: number, separators: string[]): string[] {
  if (text.length <= chunkSize) return [text];
  const [sep, ...rest] = separators;
  if (sep === undefined) {
    const pieces: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) pieces.push(text.slice(i, i + chunkSize));
    return pieces;
  }
  const parts = text.split(sep);
  if (parts.length === 1) return split(text, chunkSize, rest);
  return parts
    .map((p, i) => (i < parts.length - 1 ? p + sep : p))
    .flatMap((p) => (p.length > chunkSize ? split(p, chunkSize, rest) : [p]));
}

/** Une piezas pequeñas en fragmentos de ~chunkSize con solapamiento. */
function merge(pieces: string[], chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current.length + piece.length > chunkSize && current.trim()) {
      chunks.push(current.trim());
      const tail = current.slice(-overlap);
      // Empezar el solapamiento en un límite de palabra.
      const space = tail.indexOf(' ');
      current = space >= 0 ? tail.slice(space + 1) : '';
    }
    current += piece;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function chunkSections(sections: TextSection[], options: ChunkOptions = {}): Chunk[] {
  const chunkSize = options.chunkSize ?? 1000;
  const overlap = Math.min(options.overlap ?? 200, Math.floor(chunkSize / 2));

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const text = normalize(section.text);
    if (!text) continue;
    for (const content of merge(split(text, chunkSize, SEPARATORS), chunkSize, overlap)) {
      // Descarta fragmentos sin contenido útil (números de página sueltos, etc.).
      if (content.replace(/[\W\d_]+/g, '').length < 3) continue;
      chunks.push({ content, metadata: section.page ? { page: section.page } : {} });
    }
  }
  return chunks;
}
