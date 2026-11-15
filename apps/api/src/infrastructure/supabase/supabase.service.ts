import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppConfig } from '../../config/app-config';
import type { DataScope } from '../../application/ports/data-scope';

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

/** Clientes de usuario recientes (una petición suele hacer varias consultas con el mismo token). */
const USER_CLIENTS_MAX = 200;

@Injectable()
export class SupabaseService {
  /** Cliente con service_role: ignora RLS. Usar solo en el worker y tareas del servidor. */
  readonly admin: SupabaseClient;
  private readonly userClients = new Map<string, SupabaseClient>();

  constructor(private readonly config: AppConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, clientOptions);
  }

  /**
   * Cliente que actúa como el usuario autenticado: todas las consultas pasan
   * por las políticas RLS, que son las que aíslan a cada empresa.
   */
  forUser(accessToken: string): SupabaseClient {
    const hit = this.userClients.get(accessToken);
    if (hit) {
      // Menos usado recientemente al final del recorrido.
      this.userClients.delete(accessToken);
      this.userClients.set(accessToken, hit);
      return hit;
    }
    const client = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
      ...clientOptions,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    this.userClients.set(accessToken, client);
    if (this.userClients.size > USER_CLIENTS_MAX) {
      this.userClients.delete(this.userClients.keys().next().value as string);
    }
    return client;
  }

  /** Cliente para un ámbito de datos de la aplicación. */
  client(scope: DataScope): SupabaseClient {
    return scope.kind === 'user' ? this.forUser(scope.accessToken) : this.admin;
  }
}
