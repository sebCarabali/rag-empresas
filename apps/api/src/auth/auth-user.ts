import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email?: string;
  /** JWT del usuario, para crear un cliente de Supabase que respete RLS. */
  accessToken: string;
}

/** Inyecta el usuario autenticado en un parámetro del controlador. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
