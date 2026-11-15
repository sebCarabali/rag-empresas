import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import type { LlmEvent, LlmTarget } from '../chat/llm.service';
import { LlmService, describeFailure } from '../chat/llm.service';
import { DEFAULT_CHATBOT } from '../chatbots/chatbots.service';
import { unwrap } from '../common/supabase-error';
import { CompanyKeysService } from '../companies/company-keys.service';
import { AppConfig } from '../config/app-config';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { ReindexService } from '../embeddings/reindex.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  EMBEDDING_MODELS,
  LLM_PROVIDERS,
  LLM_SUGGESTIONS,
  MODEL_ID_PATTERN,
  PROVIDER_LABEL,
  embeddingModel,
  type LlmProvider,
} from './catalog';
import { ModelSettingsService, toSettings } from './model-settings.service';

const MODEL_COLUMNS = 'llm_provider, llm_model, llm_fallback, llm_fallback_model, embedding_model';

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
 * claves de API de la empresa para cada proveedor.
 */
@Controller()
export class ModelsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly models: ModelSettingsService,
    private readonly keys: CompanyKeysService,
    private readonly llm: LlmService,
    private readonly embeddings: EmbeddingsService,
    private readonly reindex: ReindexService,
    private readonly config: AppConfig,
  ) {}

  private async project(user: AuthUser, projectId: string) {
    const db = this.supabase.forUser(user.accessToken);
    const project = unwrap(
      await db.from('projects').select('id, company_id').eq('id', projectId).single(),
      'Proyecto no encontrado',
    );
    const canEdit = Boolean(
      unwrap(await db.rpc('has_company_role', { p_company_id: project.company_id, p_roles: ['owner', 'admin'] })),
    );
    return { db, project, canEdit };
  }

  /** Configuración actual, opciones disponibles y qué claves hay. */
  @Get('projects/:projectId/models')
  async get(@CurrentUser() user: AuthUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const { db, project, canEdit } = await this.project(user, projectId);
    const { data } = await db.from('chatbots').select(MODEL_COLUMNS).eq('project_id', projectId).maybeSingle();
    const keys = await this.models.availability(project.company_id);
    return {
      canEdit,
      companyId: project.company_id,
      settings: toSettings(data),
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
    const { db, project, canEdit } = await this.project(user, projectId);
    if (!canEdit) throw new ForbiddenException('Solo owner o admin pueden cambiar los modelos');

    const keys = await this.models.availability(project.company_id);
    const hasKey = (p: LlmProvider) => keys[p].company || keys[p].platform;
    if (!hasKey(dto.llmProvider)) {
      throw new BadRequestException(`Para usar ${PROVIDER_LABEL[dto.llmProvider]} primero guarda la clave de API de la empresa.`);
    }
    if (dto.llmFallback !== 'none' && !hasKey(dto.llmFallback)) {
      throw new BadRequestException(`Para usar ${PROVIDER_LABEL[dto.llmFallback]} como respaldo primero guarda su clave de API.`);
    }
    const emb = dto.embeddingModel ? embeddingModel(dto.embeddingModel) : null;
    if (emb && emb.provider !== 'local' && !hasKey(emb.provider)) {
      throw new BadRequestException(`El modelo ${emb.label} necesita la clave de ${PROVIDER_LABEL[emb.provider]} de la empresa.`);
    }

    const values = {
      llm_provider: dto.llmProvider,
      llm_model: dto.llmModel?.trim() || null,
      llm_fallback: dto.llmFallback,
      llm_fallback_model: dto.llmFallback === 'none' ? null : dto.llmFallbackModel?.trim() || null,
      // El modelo por defecto de la plataforma se guarda como null (sigue los cambios de la plataforma).
      embedding_model: dto.embeddingModel && dto.embeddingModel !== this.config.embeddingModel ? dto.embeddingModel : null,
    };
    const { data: existing } = await db.from('chatbots').select('id').eq('project_id', projectId).maybeSingle();
    const result = existing
      ? await db.from('chatbots').update(values).eq('id', existing.id).select(MODEL_COLUMNS).single()
      : await db
          .from('chatbots')
          .insert({ ...DEFAULT_CHATBOT, ...values, project_id: projectId, company_id: project.company_id })
          .select(MODEL_COLUMNS)
          .single();
    unwrap(result, 'Solo owner o admin pueden cambiar los modelos');
    this.models.invalidate(projectId);

    // Nuevo modelo de embeddings: se recalculan los del proyecto en segundo plano.
    const status = await this.reindex.status(projectId);
    if (status.outdated) await this.reindex.start(projectId).catch(() => false);
    return this.get(user, projectId);
  }

  /** Prueba un modelo con una pregunta mínima, con las claves de la empresa o de la plataforma. */
  @Post('projects/:projectId/models/test')
  @HttpCode(200)
  async test(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: TestDto,
  ) {
    const { project, canEdit } = await this.project(user, projectId);
    if (!canEdit) throw new ForbiddenException('Solo owner o admin pueden probar los modelos');
    const started = Date.now();

    if (dto.kind === 'embedding') {
      const model = dto.model || this.config.embeddingModel;
      if (!embeddingModel(model)) throw new BadRequestException('Modelo de embeddings no disponible');
      try {
        const v = await this.embeddings.embedQuery('¿Qué productos tienen?', { model, companyId: project.company_id });
        return { ok: true, ms: Date.now() - started, detail: `${v.length} dimensiones` };
      } catch (err) {
        return { ok: false, ms: Date.now() - started, detail: (err as Error).message.slice(0, 300) };
      }
    }

    const provider = dto.provider ?? 'gemini';
    const target: LlmTarget | null = await this.models.target(project.company_id, provider, dto.model ?? null);
    if (!target) return { ok: false, ms: 0, detail: `No hay clave de ${PROVIDER_LABEL[provider]}` };
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
        keyOwner: target.keyOwner,
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

  /** Guarda la clave de un proveedor (Gemini, OpenAI o Groq) en el Vault, tras comprobar que funciona. */
  @Put('companies/:companyId/provider-keys/:provider')
  @HttpCode(204)
  async setKey(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('provider') provider: string,
    @Body() dto: ProviderKeyDto,
  ) {
    const p = this.provider(provider);
    const db = this.supabase.forUser(user.accessToken);
    const canEdit = unwrap(await db.rpc('has_company_role', { p_company_id: companyId, p_roles: ['owner', 'admin'] }));
    if (!canEdit) throw new ForbiddenException('Solo owner o admin pueden cambiar las claves');
    await this.keys.validateKey(p, dto.apiKey.trim());
    unwrap(
      await db
        .rpc('set_company_provider_key', { p_company_id: companyId, p_provider: p, p_key: dto.apiKey.trim() })
        .then((r) => ({ ...r, data: true })),
    );
    this.keys.invalidate(companyId);
  }

  /** Elimina la clave de un proveedor: se vuelve a usar la de la plataforma, si existe. */
  @Delete('companies/:companyId/provider-keys/:provider')
  @HttpCode(204)
  async deleteKey(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('provider') provider: string,
  ) {
    const p = this.provider(provider);
    const db = this.supabase.forUser(user.accessToken);
    unwrap(
      await db.rpc('delete_company_provider_key', { p_company_id: companyId, p_provider: p }).then((r) => ({ ...r, data: true })),
    );
    this.keys.invalidate(companyId);
  }

  private provider(value: string): LlmProvider {
    if (!(LLM_PROVIDERS as string[]).includes(value)) throw new BadRequestException('Proveedor no válido');
    return value as LlmProvider;
  }
}
