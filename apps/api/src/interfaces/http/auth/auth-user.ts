import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { userScope, type DataScope } from '../../../application/ports/data-scope';

export interface AuthUser {
  id: string;
  email?: string;
  /** JWT del usuario: con él los datos se leen respetando sus permisos (RLS). */
  accessToken: string;
}

/** Inyecta el usuario autenticado en un parámetro del controlador. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** Ámbito de datos del usuario: todas las lecturas y escrituras respetan sus permisos. */
export function scopeOf(user: AuthUser): DataScope {
  return userScope(user.accessToken);
}
