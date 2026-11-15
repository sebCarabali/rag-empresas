import type { TokenUsage } from '../../domain/llm/llm';

export interface WebDescriptionResult {
  description: string;
  sources: Array<{ title: string; url: string }>;
  queries: string[];
  usage?: TokenUsage | null;
}

/** Puerto de salida: describe un valor del catálogo buscando en la web (con la clave del asistente). */
export interface WebResearcher {
  describe(
    field: string,
    value: string,
    context: { composiciones?: string[]; tipos_de_tejido?: string[] },
    apiKey: string,
  ): Promise<WebDescriptionResult>;
}

export const WEB_RESEARCHER = Symbol('WEB_RESEARCHER');
