import { Injectable } from '@nestjs/common';
import { GoogleGenAI, type Content } from '@google/genai';
import { AppConfig } from '../config/app-config';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class GeminiService {
  private readonly ai: GoogleGenAI;

  constructor(private readonly config: AppConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  /** Genera la respuesta en streaming; cada valor emitido es un fragmento de texto. */
  async *stream(systemInstruction: string, turns: ChatTurn[], signal?: AbortSignal): AsyncGenerator<string> {
    const contents: Content[] = turns.map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }],
    }));

    const response = await this.ai.models.generateContentStream({
      model: this.config.geminiModel,
      contents,
      config: { systemInstruction, abortSignal: signal },
    });

    for await (const chunk of response) {
      const text = chunk.text;
      if (text) yield text;
    }
  }
}
