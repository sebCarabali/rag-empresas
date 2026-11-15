import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import { COMPANY_REPOSITORY, type CompanyRepository } from '../../../application/ports';

class CreateCompanyDto {
  @IsString()
  @Length(2, 120)
  name: string;
}

@Controller()
export class CompaniesController {
  constructor(@Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository) {}

  /** Usuario actual y las empresas a las que pertenece (con su rol). */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return {
      user: { id: user.id, email: user.email },
      companies: await this.companies.memberships(scopeOf(user), user.id),
    };
  }

  @Get('companies')
  list(@CurrentUser() user: AuthUser) {
    return this.companies.memberships(scopeOf(user), user.id);
  }

  /** Crea una empresa; quien la crea queda como owner. */
  @Post('companies')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateCompanyDto) {
    return { ...(await this.companies.create(scopeOf(user), dto.name)), role: 'owner' };
  }
}
