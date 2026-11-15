import { Inject, Injectable } from '@nestjs/common';
import type { LlmProvider } from '../../domain/models/catalog';
import { CHAT_MODELS, type ChatModel } from '../ports';

/**
 * Registro de adaptadores de modelos (Registry): resuelve el adaptador de un
 * proveedor sin que la aplicación conozca las clases concretas.
 */
@Injectable()
export class ChatModelRegistry {
  private readonly byProvider: Map<LlmProvider, ChatModel>;

  constructor(@Inject(CHAT_MODELS) models: ChatModel[]) {
    this.byProvider = new Map(models.map((m) => [m.provider, m]));
  }

  get(provider: LlmProvider): ChatModel {
    const model = this.byProvider.get(provider);
    if (!model) throw new Error(`No hay adaptador para el proveedor ${provider}`);
    return model;
  }

  providers(): LlmProvider[] {
    return [...this.byProvider.keys()];
  }
}
