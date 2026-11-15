import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_CHATBOT, type ChatbotRow } from '../../domain/chatbots/chatbot';
import type { BotProfile } from '../../domain/chat/prompt';
import { CHATBOT_REPOSITORY, type ChatbotRepository, type DataScope } from '../ports';

/** Asistente del proyecto y perfil con que responde a cada audiencia. */
@Injectable()
export class ChatbotsService {
  constructor(@Inject(CHATBOT_REPOSITORY) private readonly repository: ChatbotRepository) {}

  findByProject(scope: DataScope, projectId: string): Promise<ChatbotRow | null> {
    return this.repository.findByProject(scope, projectId);
  }

  findByPublicKey(publicKey: string): Promise<ChatbotRow | null> {
    return this.repository.findByPublicKey(publicKey);
  }

  profile(bot: Pick<ChatbotRow, 'name' | 'language' | 'instructions'> | null, audience: BotProfile['audience']): BotProfile | null {
    if (!bot) return audience === 'public' ? { ...DEFAULT_CHATBOT, audience } : null;
    return { name: bot.name, language: bot.language, instructions: bot.instructions, audience };
  }
}
