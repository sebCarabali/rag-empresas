import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC = 'isPublic';
/** Marca un endpoint como público (sin JWT). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthenticatedRequest = Request & { user: AuthUser };

/**
 * Valida el JWT de Supabase Auth enviado en `Authorization: Bearer <token>`.
 * getClaims() verifica la firma con las llaves públicas (JWKS) del proyecto
 * y las cachea, así que no hace una llamada a Supabase en cada petición.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
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

    const { data, error } = await this.supabase.admin.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      throw new UnauthorizedException('Token inválido o vencido');
    }

    request.user = {
      id: data.claims.sub,
      email: typeof data.claims.email === 'string' ? data.claims.email : undefined,
      accessToken: token,
    };
    return true;
  }
}
