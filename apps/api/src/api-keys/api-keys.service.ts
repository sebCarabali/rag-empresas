import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { ChatbotsService, type ChatbotRow } from '../chatbots/chatbots.service';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from '../supabase/supabase.service';

const KEY_PREFIX = 'sk_live_';
const KEY_PATTERN = /^sk_live_[A-Za-z0-9_-]{43}$/;
/** Duración de un token del widget: por defecto 1 h, máximo 24 h. */
export const TOKEN_DEFAULT_TTL = 3600;
export const TOKEN_MAX_TTL = 86_400;

export interface WidgetTokenClaims {
  /** Chatbot al que da acceso. */
  bot: string;
  /** Vence (segundos Unix). */
  exp: number;
  /** Visitante según la empresa (opcional): agrupa sus preguntas. */
  sub?: string;
}

export interface ApiKeyContext {
  keyId: string;
  companyId: string;
  projectId: string;
  chatbot: ChatbotRow | null;
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Clave nueva: 32 bytes aleatorios en base64url (43 caracteres). */
export function generateKey(): { key: string; prefix: string; last4: string; hash: string } {
  const key = KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 4), last4: key.slice(-4), hash: hashKey(key) };
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** Token compacto firmado con HMAC-SHA256: wt1.<datos>.<firma>. */
export function signToken(claims: WidgetTokenClaims, secret: Buffer): string {
  const body = b64(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(`wt1.${body}`).digest('base64url');
  return `wt1.${body}.${sig}`;
}

export function verifyToken(token: string, secret: Buffer, now = Date.now()): WidgetTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'wt1') return null;
  const expected = createHmac('sha256', secret).update(`wt1.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as WidgetTokenClaims;
    if (typeof claims.bot !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Claves secretas de API (las genera la API, se muestran una vez y se guarda
 * solo su hash) y tokens temporales del widget firmados por el servidor.
 */
@Injectable()
export class ApiKeysService {
  private readonly secret: Buffer;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly chatbots: ChatbotsService,
    config: AppConfig,
  ) {
    this.secret = config.widgetTokenSecret
      ? Buffer.from(config.widgetTokenSecret)
      : Buffer.from(hkdfSync('sha256', config.supabaseServiceRoleKey, 'rag-empresas', 'widget-token-v1', 32));
  }

  /** Valida `Authorization: Bearer sk_live_…` y devuelve el proyecto de la clave. */
  async authenticate(header: string | undefined): Promise<ApiKeyContext> {
    const [scheme, key] = (header ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !key || !KEY_PATTERN.test(key)) {
      throw new UnauthorizedException('Falta la clave de API (Authorization: Bearer sk_live_…)');
    }
    const db = this.supabase.admin;
    const { data: row } = await db
      .from('api_keys')
      .select('id, company_id, project_id, revoked_at')
      .eq('key_hash', hashKey(key))
      .maybeSingle();
    if (!row || row.revoked_at) throw new UnauthorizedException('Clave de API no válida o revocada');
    void db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(() => undefined);
    return {
      keyId: row.id as string,
      companyId: row.company_id as string,
      projectId: row.project_id as string,
      chatbot: await this.chatbots.findByProject(db, row.project_id as string),
    };
  }

  issueToken(chatbotId: string, ttlSeconds = TOKEN_DEFAULT_TTL, subject?: string) {
    const ttl = Math.min(Math.max(Math.floor(ttlSeconds) || TOKEN_DEFAULT_TTL, 60), TOKEN_MAX_TTL);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const claims: WidgetTokenClaims = { bot: chatbotId, exp, ...(subject ? { sub: subject.slice(0, 120) } : {}) };
    return { token: signToken(claims, this.secret), expiresAt: new Date(exp * 1000).toISOString(), expiresIn: ttl };
  }

  /** Token válido para este chatbot, o null. */
  checkToken(token: string | undefined, chatbotId: string): WidgetTokenClaims | null {
    if (!token) return null;
    const claims = verifyToken(token, this.secret);
    return claims && claims.bot === chatbotId ? claims : null;
  }
}
