import { Inject, Injectable, Logger } from '@nestjs/common';
import { geminiClient } from '../llm/gemini-chat-model';
import { AppConfig } from '../../config/app-config';
import { USAGE_RECORDER, type TextRecognizer, type UsageRecorder } from '../../application/ports';
import { geminiUsage } from '../llm/gemini-usage';
import type { TextSection } from '../../domain/ingestion/documents';

/** Por encima de este tamaño el archivo se sube con la Files API en vez de ir dentro de la petición. */
const INLINE_LIMIT_BYTES = 15 * 1024 * 1024;

const OCR_PROMPT =
  'Transcribe TODO el texto de este documento, en su idioma original, sin resumir ni comentar. ' +
  'Antes del texto de cada página escribe una línea exacta "=== Página N ===" (N empieza en 1). ' +
  'Conserva títulos y párrafos. Escribe las tablas fila por fila separando las columnas con " | ". ' +
  'Si una parte es ilegible escribe [ilegible]. Si no hay texto en una página, deja solo su marcador.';

/** Divide la transcripción en secciones por página usando los marcadores. */
export function splitOcrPages(text: string): TextSection[] {
  const parts = text.split(/^\s*=+\s*P[áa]gina\s+(\d+)\s*=+\s*$/im);
  if (parts.length === 1) return text.trim() ? [{ text: text.trim() }] : [];
  const sections: TextSection[] = [];
  if (parts[0].trim()) sections.push({ text: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) {
    const body = (parts[i + 1] ?? '').trim();
    if (body) sections.push({ text: body, page: Number(parts[i]) });
  }
  return sections;
}

/**
 * Reconocimiento de texto (OCR) con Gemini para PDF escaneados e imágenes.
 * Usa la clave de Gemini del asistente del proyecto.
 */
@Injectable()
export class GeminiOcrService implements TextRecognizer {
  private readonly logger = new Logger(GeminiOcrService.name);

  constructor(
    private readonly config: AppConfig,
    @Inject(USAGE_RECORDER) private readonly usage: UsageRecorder,
  ) {}

  async transcribe(
    buffer: Buffer,
    mimeType: string,
    apiKey: string,
    context?: { companyId: string; projectId: string },
  ): Promise<TextSection[]> {
    const ai = geminiClient(apiKey);
    const started = Date.now();

    let filePart: Record<string, unknown>;
    let uploadedName: string | undefined;
    if (buffer.length <= INLINE_LIMIT_BYTES) {
      filePart = { inlineData: { mimeType, data: buffer.toString('base64') } };
    } else {
      const uploaded = await ai.files.upload({
        file: new Blob([new Uint8Array(buffer)], { type: mimeType }),
        config: { mimeType },
      });
      uploadedName = uploaded.name;
      filePart = { fileData: { mimeType, fileUri: uploaded.uri } };
    }

    try {
      const response = await ai.models.generateContent({
        model: this.config.geminiModel,
        contents: [{ role: 'user', parts: [filePart, { text: OCR_PROMPT }] }],
      });
      const text = response.text ?? '';
      if (context) {
        void this.usage.record({
          ...context,
          channel: 'ocr',
          provider: 'gemini',
          model: this.config.geminiModel,
          keyOwner: 'company',
          usage: geminiUsage(response.usageMetadata),
          durationMs: Date.now() - started,
        });
      }
      const sections = splitOcrPages(text);
      this.logger.log(`OCR: ${sections.length} páginas, ${text.length} caracteres en ${Date.now() - started} ms`);
      return sections;
    } finally {
      if (uploadedName) await ai.files.delete({ name: uploadedName }).catch(() => undefined);
    }
  }
}
