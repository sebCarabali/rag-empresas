import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DomainErrorFilter } from './domain-error.filter';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../domain/errors';
import { InvalidApiKeyError } from '../../application/api-keys/api-keys.service';
import { check, unwrap } from '../../infrastructure/persistence/supabase-result';

function respond(error: Error, headersSent = false) {
  const out: { status?: number; body?: unknown; ended?: boolean } = {};
  const res = {
    headersSent,
    status: (s: number) => ((out.status = s), res),
    json: (b: unknown) => void (out.body = b),
    end: () => void (out.ended = true),
  };
  new DomainErrorFilter().catch(error as never, { switchToHttp: () => ({ getResponse: () => res }) } as never);
  return out;
}

test('el filtro traduce cada error de la aplicación a su código HTTP', () => {
  assert.equal(respond(new NotFoundError('Proyecto no encontrado')).status, 404);
  assert.equal(respond(new ForbiddenError()).status, 403);
  assert.equal(respond(new ConflictError('ya en curso')).status, 409);
  assert.equal(respond(new InvalidInputError('mal')).status, 400);
  assert.equal(respond(new InvalidApiKeyError('falta')).status, 401);
  assert.deepEqual(respond(new NotFoundError('Proyecto no encontrado')).body, {
    statusCode: 404,
    message: 'Proyecto no encontrado',
    error: 'Not Found',
  });
  assert.deepEqual(respond(new ForbiddenError(), true), { ended: true });
});

test('los errores de PostgREST se traducen a errores de la aplicación', () => {
  const err = (code: string) => ({ code, message: `pg ${code}`, details: '', hint: '', name: 'PostgrestError' }) as never;
  assert.throws(() => check(err('PGRST116'), 'No está'), (e: Error) => e instanceof NotFoundError && e.message === 'No está');
  assert.throws(() => check(err('42501')), ForbiddenError);
  assert.throws(() => check(err('23505')), InvalidInputError);
  assert.throws(() => check(err('23514')), InvalidInputError);
  assert.throws(() => check(err('XX000')), (e: Error) => !(e instanceof NotFoundError) && e.message === 'pg XX000');
  assert.throws(() => unwrap({ data: null, error: null }, 'Vacío'), NotFoundError);
  assert.deepEqual(unwrap({ data: [1], error: null }), [1]);
});
