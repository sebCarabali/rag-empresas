import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';
import { CompanyKeysService } from './company-keys.service';

class CreateCompanyDto {
  @IsString()
  @Length(2, 120)
  name: string;
}

class GeminiKeyDto {
  @IsString()
  @Length(20, 200)
  @Matches(/^\S+$/, { message: 'La clave no debe tener espacios' })
  apiKey: string;
}

@Controller()
export class CompaniesController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly keys: CompanyKeysService,
  ) {}

  /** Usuario actual y las empresas a las que pertenece (con su rol). */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const db = this.supabase.forUser(user.accessToken);
    const memberships = unwrap(
      await db
        .from('company_members')
        .select('role, company:companies(id, name, created_at)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true }),
    );
    return {
      user: { id: user.id, email: user.email },
      companies: memberships.map((m: any) => ({ ...m.company, role: m.role })),
    };
  }

  @Get('companies')
  async list(@CurrentUser() user: AuthUser) {
    return (await this.me(user)).companies;
  }

  /** Crea una empresa; quien la crea queda como owner. */
  @Post('companies')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateCompanyDto) {
    const db = this.supabase.forUser(user.accessToken);
    const company = unwrap(await db.rpc('create_company', { p_name: dto.name }).single());
    return { ...(company as object), role: 'owner' };
  }

  /** Ajustes de la empresa. De la clave de Gemini solo se muestra si existe y sus últimos 4 caracteres. */
  @Get('companies/:companyId/settings')
  async settings(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    const db = this.supabase.forUser(user.accessToken);
    const canEdit = unwrap(await db.rpc('has_company_role', { p_company_id: companyId, p_roles: ['owner', 'admin'] }));
    const { data } = await db
      .from('company_secrets')
      .select('gemini_key_last4, gemini_key_updated_at')
      .eq('company_id', companyId)
      .maybeSingle();
    return {
      canEdit,
      gemini: {
        configured: Boolean(data?.gemini_key_last4),
        last4: data?.gemini_key_last4 ?? null,
        updatedAt: data?.gemini_key_updated_at ?? null,
      },
    };
  }

  /** Guarda la clave de Gemini de la empresa en Supabase Vault (cifrada), tras comprobar que funciona. */
  @Put('companies/:companyId/gemini-key')
  @HttpCode(204)
  async setGeminiKey(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: GeminiKeyDto,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    const canEdit = unwrap(await db.rpc('has_company_role', { p_company_id: companyId, p_roles: ['owner', 'admin'] }));
    if (!canEdit) throw new ForbiddenException('Solo owner o admin pueden cambiar la clave');
    await this.keys.validateGeminiKey(dto.apiKey.trim());
    unwrap(await db.rpc('set_company_gemini_key', { p_company_id: companyId, p_key: dto.apiKey.trim() }).then((r) => ({ ...r, data: true })));
    this.keys.invalidate(companyId);
  }

  /** Elimina la clave propia: la empresa vuelve a usar la de la plataforma. */
  @Delete('companies/:companyId/gemini-key')
  @HttpCode(204)
  async deleteGeminiKey(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    const db = this.supabase.forUser(user.accessToken);
    unwrap(await db.rpc('delete_company_gemini_key', { p_company_id: companyId }).then((r) => ({ ...r, data: true })));
    this.keys.invalidate(companyId);
  }
}
