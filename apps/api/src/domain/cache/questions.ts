/**
 * Reglas del dominio sobre preguntas y respuestas para la caché (sin
 * dependencias): normalización, preguntas de seguimiento y respuestas vacías.
 */

/** "¿Cuántas telas de ALGODÓN hay?" y "cuantas telas de algodon hay" comparten clave. */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palabras con las que empieza una pregunta que continúa la anterior ("¿y en plano?"). */
const FOLLOW_UP_START = /^(y|e|o|pero|entonces|tambien|ademas|igual|mismo|lo mismo|otra vez|de nuevo|mas|menos|ahora|y si|y que|y cual|y cuales|y cuantos|y cuantas|y el|y la|y los|y las|solo|sino|por que no)\b/;

/** Referencias a algo dicho antes en la conversación. */
const FOLLOW_UP_REFERENCE = /\b(es[ao]s?|est[ao]s?|aquell[ao]s?|ese|este|aquel|ell[ao]s?|anterior(es)?|mencionad[ao]s?|dich[ao]s?|previ[ao]s?|ultim[ao]s?|primer[ao]s?|segund[ao]s?|tercer[ao]s?|la otra|el otro|los otros|las otras|lo que dijiste|me dijiste|arriba|de la lista|de esa lista|cual de|cuales de|de ellas|de ellos)\b/;

/**
 * ¿La pregunta depende de la conversación anterior? En la primera pregunta
 * nunca; después, si empieza como continuación, hace referencia a algo dicho
 * antes o es demasiado corta para entenderse sola.
 */
export function isFollowUp(question: string, hasHistory: boolean): boolean {
  if (!hasHistory) return false;
  const q = normalizeQuestion(question);
  if (q.split(' ').length <= 2) return true;
  return FOLLOW_UP_START.test(q) || FOLLOW_UP_REFERENCE.test(q);
}

/**
 * Respuestas que dicen que no hay información ("no aparece", "no encontré"…).
 * Suelen venir de una búsqueda que no trajo lo necesario o del modelo de
 * respaldo sin herramientas: guardarlas fijaría un "no" incorrecto.
 */
const NEGATIVE_ANSWER =
  /\b(no (se )?(encontr|aparec|hay (informaci|datos)|tengo (informaci|datos)|dispongo|cuento con|figura|incluye|contiene|menciona|se enumeran)|sin informaci|lo siento)/;

export function isNegativeAnswer(answer: string): boolean {
  // Solo la primera oración: una respuesta útil puede aclarar más adelante lo que no está.
  const first = answer.trim().split(/(?<=[.!?])\s|\n/)[0].slice(0, 240);
  return NEGATIVE_ANSWER.test(normalizeQuestion(first));
}
