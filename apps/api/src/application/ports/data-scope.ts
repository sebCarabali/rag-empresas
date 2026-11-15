/**
 * Con qué permisos se leen y escriben los datos.
 *
 * - `user`: como el usuario autenticado. Las políticas de la base (RLS) aíslan
 *   a cada empresa y aplican su rol.
 * - `system`: el servidor (worker de la cola, widget y API pública, que ya
 *   validaron el acceso al proyecto por otra vía). Ignora RLS.
 */
export type DataScope =
  | { readonly kind: 'system' }
  | { readonly kind: 'user'; readonly accessToken: string };

export const SYSTEM_SCOPE: DataScope = Object.freeze({ kind: 'system' });

export function userScope(accessToken: string): DataScope {
  return { kind: 'user', accessToken };
}
