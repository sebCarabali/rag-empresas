import { BadRequestException, Injectable } from '@nestjs/common';
import { PROVIDER_LABEL, type LlmProvider } from '../../domain/models/catalog';
import type { ProviderKeyValidator } from '../../application/ports';
import { AppConfig } from '../../config/app-config';
import { geminiClient } from '../llm/gemini-chat-model';
import { dialectFor } from '../llm/openai-dialects';

/** Adaptador del puerto ProviderKeyValidator: comprueba la clave contra la API del proveedor. */
@Injectable()
export class HttpProviderKeyValidator implements ProviderKeyValidator {
  constructor(private readonly config: AppConfig) {}

  async validate(provider: LlmProvider, apiKey: string): Promise<void> {
    const label = PROVIDER_LABEL[provider];
    if (provider === 'gemini') {
      try {
        await geminiClient(apiKey).models.get({ model: this.config.geminiModel });
        return;
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        if (/api key|401|403|permission|invalid/i.test(msg)) {
          throw new BadRequestException('Gemini rechazó la clave: revisa que esté completa y activa.');
        }
        if (/404|not found/i.test(msg)) return; // la clave sirve; el modelo se elige aparte
        throw new BadRequestException(`No se pudo verificar la clave con Gemini: ${msg.slice(0, 200)}`);
      }
    }
    const dialect = dialectFor(provider)!;
    let res: Response;
    try {
      res = await fetch(`${dialect.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new BadRequestException(`No se pudo verificar la clave con ${label}: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new BadRequestException(`${label} rechazó la clave: revisa que esté completa y activa.`);
    }
    if (!res.ok) throw new BadRequestException(`No se pudo verificar la clave con ${label} (error ${res.status}).`);
  }
}
