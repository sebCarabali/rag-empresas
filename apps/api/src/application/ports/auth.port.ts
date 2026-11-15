/** Puerto de salida: verifica el token de sesión del usuario (firma y vencimiento). */
export interface AccessTokenVerifier {
  /** El usuario del token, o null si no es válido o venció. */
  verify(accessToken: string): Promise<{ id: string; email?: string } | null>;
}

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');
