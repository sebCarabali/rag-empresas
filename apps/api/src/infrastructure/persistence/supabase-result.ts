import type { PostgrestError } from '@supabase/supabase-js';
import { ForbiddenError, InvalidInputError, NotFoundError } from '../../domain/errors';

/** Traduce errores de PostgREST / RLS a errores de la aplicación. */
export function check(error: PostgrestError | null, notFoundMessage = 'No encontrado'): void {
  if (!error) return;
  switch (error.code) {
    case 'PGRST116': // .single() sin filas: no existe o RLS lo oculta
      throw new NotFoundError(notFoundMessage);
    case '42501': // violación de RLS
      throw new ForbiddenError();
    case '23505':
      throw new InvalidInputError('El registro ya existe');
    case '23503':
    case '22P02':
    case '23514':
      throw new InvalidInputError(error.message);
    default:
      throw new Error(error.message);
  }
}

/** Devuelve data o lanza el error de la aplicación adecuado. */
export function unwrap<T>(result: { data: T; error: PostgrestError | null }, notFoundMessage?: string): NonNullable<T> {
  check(result.error, notFoundMessage);
  if (result.data === null || result.data === undefined) throw new NotFoundError(notFoundMessage);
  return result.data as NonNullable<T>;
}
