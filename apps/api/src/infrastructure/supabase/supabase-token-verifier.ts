import { Injectable } from '@nestjs/common';
import type { AccessTokenVerifier } from '../../application/ports';
import { SupabaseService } from './supabase.service';

/**
 * Adaptador de AccessTokenVerifier sobre Supabase Auth. getClaims() verifica la
 * firma con las llaves públicas (JWKS) del proyecto y las cachea, así que no
 * hace una llamada a Supabase en cada petición.
 */
@Injectable()
export class SupabaseTokenVerifier implements AccessTokenVerifier {
  constructor(private readonly supabase: SupabaseService) {}

  async verify(accessToken: string): Promise<{ id: string; email?: string } | null> {
    try {
      const { data, error } = await this.supabase.admin.auth.getClaims(accessToken);
      const claims = error ? undefined : (data?.claims as { sub?: string; email?: unknown } | undefined);
      if (!claims?.sub) return null;
      return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : undefined };
    } catch {
      // Token malformado: getClaims puede lanzar en lugar de devolver error.
      return null;
    }
  }
}
