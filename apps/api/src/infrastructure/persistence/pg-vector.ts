/** Formato de texto que entiende pgvector: "[0.1,0.2,...]". */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
