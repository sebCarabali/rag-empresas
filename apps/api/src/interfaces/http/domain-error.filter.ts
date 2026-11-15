import { ArgumentsHost, Catch, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ConflictError, DomainError, ForbiddenError, InvalidInputError, NotFoundError } from '../../domain/errors';
import { InvalidApiKeyError } from '../../application/api-keys/api-keys.service';

const STATUS: Array<[new (...args: never[]) => DomainError, HttpStatus, string]> = [
  [NotFoundError, HttpStatus.NOT_FOUND, 'Not Found'],
  [ForbiddenError, HttpStatus.FORBIDDEN, 'Forbidden'],
  [ConflictError, HttpStatus.CONFLICT, 'Conflict'],
  [InvalidInputError, HttpStatus.BAD_REQUEST, 'Bad Request'],
  [InvalidApiKeyError, HttpStatus.UNAUTHORIZED, 'Unauthorized'],
];

/** Traduce los errores de la aplicación a respuestas HTTP con el mismo formato que las de Nest. */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [, status, name] = STATUS.find(([type]) => error instanceof type) ?? [
      DomainError,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal Server Error',
    ];
    // Si ya empezó un stream (NDJSON), no se puede cambiar el código.
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json({ statusCode: status, message: error.message, error: name });
  }
}
