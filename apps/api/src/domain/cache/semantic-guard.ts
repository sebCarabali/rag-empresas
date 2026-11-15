/**
 * Control léxico de la caché por significado. Los embeddings ponen muy cerca
 * preguntas que se diferencian en un dato decisivo («algodón» / «poliéster»,
 * «popelina» / «popelina rígida», «120» / «150»). Una respuesta parecida solo
 * se reutiliza si ambas preguntas mencionan exactamente las mismas cifras y los
 * mismos términos del catálogo.
 */

/** Palabras sin tildes, en minúscula y en singular aproximado ("algodones" → "algodon"). */
export function tokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular);
}

export function singular(word: string): string {
  if (/^\d+$/.test(word) || word.length <= 4) return word;
  if (word.endsWith('ces')) return `${word.slice(0, -3)}z`; // lápices → lapiz
  if (/[^aeiou]es$/.test(word)) return word.slice(0, -2); // algodones → algodon
  if (word.endsWith('s')) return word.slice(0, -1); // telas → tela
  return word;
}

/** Cifras de la pregunta, sin separadores de miles ni unidades ("1.200 g" → "1200"). */
export function numbers(text: string): string[] {
  return [...text.replace(/(\d)[.,](?=\d{3}\b)/g, '$1').matchAll(/\d+(?:[.,]\d+)?/g)]
    .map((m) => m[0].replace(',', '.'))
    .sort();
}

/** Términos del catálogo mencionados (vocabulario ya pasado por `singular`). */
export function catalogTerms(text: string, vocabulary: Set<string>): string[] {
  return [...new Set(tokens(text).filter((t) => vocabulary.has(t)))].sort();
}

/** ¿Puede la pregunta `cached` responder a `asked`? */
export function sameIntent(asked: string, cached: string, vocabulary: Set<string>): boolean {
  if (numbers(asked).join('|') !== numbers(cached).join('|')) return false;
  return catalogTerms(asked, vocabulary).join('|') === catalogTerms(cached, vocabulary).join('|');
}

/** Palabras genéricas que no distinguen productos aunque aparezcan en el catálogo. */
const GENERIC = new Set([
  'tela', 'telas', 'para', 'con', 'sin', 'del', 'los', 'las', 'que', 'una', 'uno', 'por', 'mas', 'muy',
  'tipo', 'color', 'colore', 'otro', 'otra', 'todo', 'toda', 'cada', 'base', 'linea', 'producto',
]);

/** Prepara el vocabulario que devuelve la base de datos (palabras de valores categóricos). */
export function buildVocabulary(words: string[]): Set<string> {
  const set = new Set<string>();
  for (const t of words.flatMap(tokens)) {
    if (t.length >= 3 && !GENERIC.has(t) && !/^\d+$/.test(t)) set.add(t);
  }
  return set;
}
