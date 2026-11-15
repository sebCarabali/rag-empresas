import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';

/** Traduce errores de PostgREST/RLS a excepciones HTTP. */
export function throwSupabaseError(error: PostgrestError | null, notFoundMessage = 'No encontrado'): void {
  if (!error) return;
  switch (error.code) {
    case 'PGRST116': // .single() sin filas: no existe o RLS lo oculta
      throw new NotFoundException(notFoundMessage);
    case '42501': // violación de RLS
      throw new ForbiddenException('No tienes permiso para esta acción');
    case '23505':
      throw new BadRequestException('El registro ya existe');
    case '23503':
    case '22P02':
    case '23514':
      throw new BadRequestException(error.message);
    default:
      throw new InternalServerErrorException(error.message);
  }
}

/** Devuelve data o lanza la excepción HTTP adecuada. */
export function unwrap<T>(
  result: { data: T; error: PostgrestError | null },
  notFoundMessage?: string,
): NonNullable<T> {
  throwSupabaseError(result.error, notFoundMessage);
  if (result.data === null || result.data === undefined) {
    throw new NotFoundException(notFoundMessage ?? 'No encontrado');
  }
  return result.data as NonNullable<T>;
}
