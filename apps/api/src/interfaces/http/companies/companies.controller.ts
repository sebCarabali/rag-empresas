import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../supabase-error';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';

class CreateCompanyDto {
  @IsString()
  @Length(2, 120)
  name: string;
}

@Controller()
export class CompaniesController {
  constructor(private readonly supabase: SupabaseService) {}

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
}
