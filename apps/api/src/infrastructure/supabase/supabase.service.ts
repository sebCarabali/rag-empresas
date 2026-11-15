import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppConfig } from '../config/app-config';

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

@Injectable()
export class SupabaseService {
  /** Cliente con service_role: ignora RLS. Usar solo en el worker y tareas del servidor. */
  readonly admin: SupabaseClient;

  constructor(private readonly config: AppConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, clientOptions);
  }

  /**
   * Cliente que actúa como el usuario autenticado: todas las consultas pasan
   * por las políticas RLS, que son las que aíslan a cada empresa.
   */
  forUser(accessToken: string): SupabaseClient {
    return createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
      ...clientOptions,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }
}
