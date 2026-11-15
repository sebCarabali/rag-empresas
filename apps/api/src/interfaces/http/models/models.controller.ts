import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import { LlmService } from '../../../application/llm/llm.service';
import { describeFailure, type LlmEvent, type LlmTarget } from '../../../domain/llm/llm';
import {
  ADMIN_ROLES,
  MODEL_SETTINGS_REPOSITORY,
  PROVIDER_KEY_VALIDATOR,
  PROVIDER_KEY_WRITER,
  type DataScope,
  type ModelSettingsRepository,
  type ProjectRef,
  type ProviderKeyValidator,
  type ProviderKeyWriter,
} from '../../../application/ports';
import { ProjectAccessService } from '../../../application/access/project-access.service';
import { AppConfig } from '../../../config/app-config';
import { EmbeddingsService } from '../../../application/embeddings/embeddings.service';
import { ReindexService } from '../../../application/embeddings/reindex.service';
import {
  EMBEDDING_MODELS,
  LLM_PROVIDERS,
  LLM_SUGGESTIONS,
  MODEL_ID_PATTERN,
  PROVIDER_LABEL,
  embeddingModel,
  type LlmProvider,
} from '../../../domain/models/catalog';
import { ModelSettingsService } from '../../../application/models/model-settings.service';

class ModelSettingsDto {
  @IsIn(LLM_PROVIDERS)
  llmProvider: LlmProvider;

  @IsOptional()
  @IsString()
  @Matches(MODEL_ID_PATTERN, { message: 'Nombre de modelo no válido' })
  llmModel?: string | null;

  @IsIn(['none', ...LLM_PROVIDERS])
  llmFallback: LlmProvider | 'none';

  @IsOptional()
  @IsString()
  @Matches(MODEL_ID_PATTERN, { message: 'Nombre de modelo no válido' })
  llmFallbackModel?: string | null;

  @IsOptional()
  @IsIn(EMBEDDING_MODELS.map((m) => m.id))
  embeddingModel?: string | null;
}

class TestDto {
  @IsIn(['llm', 'embedding'])
  kind: 'llm' | 'embedding';

  @IsOptional()
  @IsIn(LLM_PROVIDERS)
  provider?: LlmProvider;

  @IsOptional()
  @IsString()
  @Matches(MODEL_ID_PATTERN, { message: 'Nombre de modelo no válido' })
  model?: string | null;
}

class ProviderKeyDto {
  @IsString()
  @Length(20, 300)
  @Matches(/^\S+$/, { message: 'La clave no debe tener espacios' })
  apiKey: string;
}

/**
 * Modelos del asistente (proveedor de lenguaje, respaldo y embeddings) y
 * claves de API del asistente para cada proveedor.
 */
@Controller()
export class ModelsController {
  constructor(
    private readonly models: ModelSettingsService,
    @Inject(MODEL_SETTINGS_REPOSITORY) private readonly settings: ModelSettingsRepository,
    @Inject(PROVIDER_KEY_WRITER) private readonly keys: ProviderKeyWriter,
    @Inject(PROVIDER_KEY_VALIDATOR) private readonly validator: ProviderKeyValidator,
    private readonly llm: LlmService,
    private readonly embeddings: EmbeddingsService,
    private readonly reindex: ReindexService,
    private readonly config: AppConfig,
    private readonly access: ProjectAccessService,
  ) {}

  private async project(user: AuthUser, projectId: string): Promise<{ scope: DataScope; project: ProjectRef; canEdit: boolean }> {
    const scope = scopeOf(user);
    const { project, allowed } = await this.access.check(scope, projectId, ADMIN_ROLES);
    return { scope, project, canEdit: allowed };
  }

  /** Configuración actual, opciones disponibles y qué claves hay. */
  @Get('projects/:projectId/models')
  async get(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const { project, canEdit } = await this.project(user, projectId);
    const keys = await this.models.availability(projectId);
    return {
      canEdit,
      companyId: project.companyId,
      settings: await this.settings.find(projectId),
      defaults: {
        llm: Object.fromEntries(LLM_PROVIDERS.map((p) => [p, this.models.defaultModel(p)])),
        embeddingModel: this.config.embeddingModel,
        fallbackEnabled: this.config.llmFallback,
      },
      providers: LLM_PROVIDERS.map((p) => ({
        id: p,
        label: PROVIDER_LABEL[p],
        suggestions: LLM_SUGGESTIONS[p],
        price: this.config.prices[p],
        ...keys[p],
      })),
      embeddings: EMBEDDING_MODELS,
      reindex: await this.reindex.status(projectId),
    };
  }

  /** Guarda los modelos (owner/admin). Si cambia el de embeddings, reindexa el proyecto. */
  @Put('projects/:projectId/models')
  async save(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ModelSettingsDto,
  ) {
    const { scope, project, canEdit } = await this.project(user, projectId);
    if (!canEdit) throw new ForbiddenException('Solo owner o admin pueden cambiar los modelos');

    const keys = await this.models.availability(projectId);
    const hasKey = (p: LlmProvider) => keys[p].configured;
    if (!hasKey(dto.llmProvider)) {
      throw new BadRequestException(`Para usar ${PROVIDER_LABEL[dto.llmProvider]} primero guarda su clave de API en este asistente.`);
    }
    if (dto.llmFallback !== 'none' && !hasKey(dto.llmFallback)) {
      throw new BadRequestException(`Para usar ${PROVIDER_LABEL[dto.llmFallback]} como respaldo primero guarda su clave de API.`);
    }
    const emb = dto.embeddingModel ? embeddingModel(dto.embeddingModel) : null;
    if (emb && emb.provider !== 'local' && !hasKey(emb.provider)) {
      throw new BadRequestException(`El modelo ${emb.label} necesita la clave de ${PROVIDER_LABEL[emb.provider]} de este asistente.`);
    }

    await this.settings.save(scope, project, {
      llmProvider: dto.llmProvider,
      llmModel: dto.llmModel?.trim() || null,
      llmFallback: dto.llmFallback,
      llmFallbackModel: dto.llmFallback === 'none' ? null : dto.llmFallbackModel?.trim() || null,
      // El modelo por defecto de la plataforma se guarda como null (sigue los cambios de la plataforma).
      embeddingModel: dto.embeddingModel && dto.embeddingModel !== this.config.embeddingModel ? dto.embeddingModel : null,
    });
    this.models.invalidate(projectId);

    // Nuevo modelo de embeddings: se recalculan los del proyecto en segundo plano.
    const status = await this.reindex.status(projectId);
    if (status.outdated) await this.reindex.start(projectId).catch(() => false);
    return this.get(user, projectId);
  }

  /** Prueba un modelo con una pregunta mínima, con la clave del asistente. */
  @Post('projects/:projectId/models/test')
  @HttpCode(200)
  async test(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: TestDto,
  ) {
    const { canEdit } = await this.project(user, projectId);
    if (!canEdit) throw new ForbiddenException('Solo owner o admin pueden probar los modelos');
    const started = Date.now();

    if (dto.kind === 'embedding') {
      const model = dto.model || this.config.embeddingModel;
      if (!embeddingModel(model)) throw new BadRequestException('Modelo de embeddings no disponible');
      try {
        const v = await this.embeddings.embedQuery('¿Qué productos tienen?', { model, projectId });
        return { ok: true, ms: Date.now() - started, detail: `${v.length} dimensiones` };
      } catch (err) {
        return { ok: false, ms: Date.now() - started, detail: (err as Error).message.slice(0, 300) };
      }
    }

    const provider = dto.provider ?? 'gemini';
    const target: LlmTarget | null = await this.models.target(projectId, provider, dto.model ?? null);
    if (!target) return { ok: false, ms: 0, detail: `Este asistente no tiene clave de ${PROVIDER_LABEL[provider]}` };
    const signal = AbortSignal.timeout(30_000);
    let answer = '';
    try {
      const events: AsyncGenerator<LlmEvent> = this.llm.run(
        'Eres una prueba de conexión. Responde en español con una sola frase corta.',
        [{ role: 'user', content: 'Di "Conexión correcta" y el nombre del modelo que eres.' }],
        { route: { primary: target, fallback: null }, signal, allowFallback: false },
      );
      for await (const e of events) if (e.type === 'text') answer += e.text;
      return {
        ok: Boolean(answer.trim()),
        ms: Date.now() - started,
        detail: answer.trim().slice(0, 200) || 'El modelo no devolvió texto',
        model: target.model,
      };
    } catch (err) {
      return {
        ok: false,
        ms: Date.now() - started,
        detail: `${describeFailure(err, provider)}: ${((err as Error).message ?? '').slice(0, 200)}`,
        model: target.model,
      };
    }
  }

  /** Guarda la clave de un proveedor (Gemini, OpenAI o Groq) del asistente en el Vault, tras comprobar que funciona. */
  @Put('projects/:projectId/provider-keys/:provider')
  @HttpCode(204)
  async setKey(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('provider') provider: string,
    @Body() dto: ProviderKeyDto,
  ) {
    const p = this.provider(provider);
    const { scope, canEdit } = await this.project(user, projectId);
    if (!canEdit) throw new ForbiddenException('Solo owner o admin pueden cambiar las claves');
    await this.validator.validate(p, dto.apiKey.trim());
    await this.keys.save(scope, projectId, p, dto.apiKey.trim());
  }

  /** Elimina la clave de un proveedor del asistente. */
  @Delete('projects/:projectId/provider-keys/:provider')
  @HttpCode(204)
  async deleteKey(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('provider') provider: string,
  ) {
    const p = this.provider(provider);
    const { scope, canEdit } = await this.project(user, projectId);
    if (!canEdit) throw new ForbiddenException('Solo owner o admin pueden cambiar las claves');
    const settings = await this.models.get(projectId);
    if (settings.llmProvider === p) {
      throw new BadRequestException(`${PROVIDER_LABEL[p]} es el modelo principal de este asistente: elige otro proveedor antes de borrar su clave.`);
    }
    await this.keys.remove(scope, projectId, p);
  }

  private provider(value: string): LlmProvider {
    if (!(LLM_PROVIDERS as string[]).includes(value)) throw new BadRequestException('Proveedor no válido');
    return value as LlmProvider;
  }
}
