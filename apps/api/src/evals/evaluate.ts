/**
 * Comparación tolerante para las pruebas de calidad: sin mayúsculas, sin tildes,
 * espacios colapsados y números con o sin separador de miles ("1.234" = "1234",
 * "1,5" = "1.5").
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\*\*|__|`/g, '') // marcas de Markdown
    .replace(/(\d)[.,](?=\d{3}(?!\d))/g, '$1') // separador de miles
    .replace(/(\d),(?=\d)/g, '$1.') // coma decimal
    .replace(/\s+/g, ' ')
    .trim();
}

export interface EvaluationOutcome {
  passed: boolean;
  /** Textos esperados que no aparecen en la respuesta. */
  missing: string[];
  /** Textos prohibidos que sí aparecen. */
  forbidden: string[];
}

export function evaluateAnswer(answer: string, mustInclude: string[], mustNotInclude: string[]): EvaluationOutcome {
  const haystack = normalizeForMatch(answer);
  const missing = mustInclude.filter((t) => t.trim() && !haystack.includes(normalizeForMatch(t)));
  const forbidden = mustNotInclude.filter((t) => t.trim() && haystack.includes(normalizeForMatch(t)));
  return { passed: answer.trim().length > 0 && missing.length === 0 && forbidden.length === 0, missing, forbidden };
}
