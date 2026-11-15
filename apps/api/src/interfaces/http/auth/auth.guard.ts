import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../../../application/ports';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC = 'isPublic';
/** Marca un endpoint como público (sin JWT). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthenticatedRequest = Request & { user: AuthUser };

/**
 * Exige `Authorization: Bearer <token>` de sesión en todo endpoint que no sea
 * @Public(). La verificación la hace el adaptador de AccessTokenVerifier.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Falta el token de acceso');
    }

    const user = await this.verifier.verify(token);
    if (!user) throw new UnauthorizedException('Token inválido o vencido');
    request.user = { ...user, accessToken: token };
    return true;
  }
}
