import { Injectable } from '@nestjs/common';
import type { WebDescriptionResult, WebResearcher } from '../../application/ports';
import { AppConfig } from '../../config/app-config';
import { geminiClient } from '../llm/gemini-chat-model';
import { geminiUsage } from '../llm/gemini-usage';

const MAX_SOURCES = 5;

/** Adaptador del puerto WebResearcher: Gemini con búsqueda en Google. */
@Injectable()
export class GeminiWebResearcher implements WebResearcher {
  constructor(private readonly config: AppConfig) {}

  /** Cliente de Gemini para una clave (se reemplaza en pruebas). */
  client: (apiKey: string) => ReturnType<typeof geminiClient> = geminiClient;

  /** Pide a Gemini (con Google Search) una descripción general verificable. */
  async describe(
    field: string,
    value: string,
    context: { composiciones?: string[]; tipos_de_tejido?: string[] },
    apiKey: string,
  ): Promise<WebDescriptionResult> {
    const details = [
      context.tipos_de_tejido?.length ? `tejido ${context.tipos_de_tejido.join(' / ').toLowerCase()}` : null,
      context.composiciones?.length ? `composiciones frecuentes: ${context.composiciones.join('; ')}` : null,
    ]
      .filter(Boolean)
      .join('; ');

    const prompt =
      `Escribe una descripción general, en español, del tipo de tela "${value}" ` +
      `(${field.toLowerCase()} en un catálogo de telas de Colombia${details ? `; ${details}` : ''}).\n` +
      'Incluye qué es, sus características (tacto, caída, elasticidad, transpirabilidad), ' +
      'usos típicos en confección y cuidados de lavado.\n' +
      'Reglas: un solo párrafo de máximo 120 palabras, sin títulos ni listas. ' +
      'No inventes marcas, precios ni datos de un fabricante. Si el nombre parece una denominación comercial ' +
      'o una agrupación interna, describe la categoría textil general que corresponde según el contexto.';

    const ai = this.client(apiKey);
    const response = await ai.models.generateContent({
      model: this.config.geminiModel,
      contents: prompt,
      config: {
        systemInstruction:
          'Eres un experto textil. Usa la búsqueda de Google para basarte en información pública verificable.',
        tools: [{ googleSearch: {} }],
      },
    });

    const description = (response.text ?? '').trim();
    if (!description) throw new Error('El modelo no devolvió una descripción');

    const meta = response.candidates?.[0]?.groundingMetadata;
    const seen = new Set<string>();
    const sources: WebDescriptionResult['sources'] = [];
    for (const chunk of meta?.groundingChunks ?? []) {
      const url = chunk.web?.uri;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ title: chunk.web?.title || chunk.web?.domain || 'Fuente web', url });
      if (sources.length === MAX_SOURCES) break;
    }
    return { description, sources, queries: meta?.webSearchQueries ?? [], usage: geminiUsage(response.usageMetadata) };
  }
}
