/**
 * Errores de la aplicación, independientes del transporte. La capa HTTP los
 * traduce a códigos de estado (ver interfaces/http/domain-error.filter.ts);
 * el worker de la cola los registra.
 */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** No existe, o los permisos del usuario lo ocultan. */
export class NotFoundError extends DomainError {
  constructor(message = 'No encontrado') {
    super(message);
  }
}

/** Existe, pero el usuario no tiene permiso para esta acción. */
export class ForbiddenError extends DomainError {
  constructor(message = 'No tienes permiso para esta acción') {
    super(message);
  }
}

/** La acción choca con el estado actual (por ejemplo, un proceso que ya está en curso). */
export class ConflictError extends DomainError {}

/** Datos no válidos o una regla de negocio no cumplida. */
export class InvalidInputError extends DomainError {}
