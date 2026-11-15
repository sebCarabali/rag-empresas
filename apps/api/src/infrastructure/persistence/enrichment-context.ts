import type { SupabaseClient } from '@supabase/supabase-js';
import type { RetrievedChunk } from '../../domain/chat/prompt';

export interface EnrichmentContext {
  field: string;
  value: string;
  description: string;
  sources: Array<{ title: string; url: string }>;
}

/** Máximo de descripciones generales que se agregan a una pregunta. */
const MAX_ENRICHMENTS = 3;

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Elige las descripciones web relevantes para la pregunta: las de valores
 * (familias, tipos de tejido…) mencionados en la pregunta o presentes en los
 * productos recuperados. Primero las mencionadas, luego las más frecuentes.
 */
export async function loadEnrichments(
  db: SupabaseClient,
  projectId: string,
  question: string,
  chunks: RetrievedChunk[],
): Promise<EnrichmentContext[]> {
  const { data, error } = await db
    .from('catalog_enrichments')
    .select('field, value, description, sources')
    .eq('project_id', projectId)
    .eq('status', 'ready')
    .limit(200);
  if (error || !data?.length) return [];

  const q = norm(question);
  const chunkText = chunks.map((c) => c.content);
  const scored = (data as EnrichmentContext[])
    .filter((e) => e.description)
    .map((e) => {
      const inQuestion = q.includes(norm(e.value));
      const line = `${e.field}: ${e.value}`;
      const inChunks = chunkText.filter((t) => t.includes(line)).length;
      return { e, score: (inQuestion ? 100 : 0) + inChunks };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_ENRICHMENTS).map((s) => s.e);
}
