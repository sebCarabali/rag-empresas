import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import 'reflect-metadata';
import { ApiKeysService, InvalidApiKeyError, MAX_ACTIVE_KEYS, generateKey, hashKey, signToken, verifyToken } from './api-keys.service';
import { InvalidInputError } from '../../domain/errors';

const secret = Buffer.from('secreto-de-prueba-de-32-bytes!!!');

test('clave de API: formato, prefijo visible y hash estable', () => {
  const k = generateKey();
  assert.match(k.key, /^sk_live_[A-Za-z0-9_-]{43}$/);
  assert.ok(k.key.startsWith(k.prefix));
  assert.equal(k.last4, k.key.slice(-4));
  assert.equal(k.hash, hashKey(k.key));
  assert.notEqual(generateKey().key, k.key);
});

test('token del widget: válido, alterado, de otro secreto y vencido', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const token = signToken({ bot: 'b1', exp, sub: 'cliente-7' }, secret);
  assert.deepEqual(verifyToken(token, secret), { bot: 'b1', exp, sub: 'cliente-7' });

  const [, body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ bot: 'b2', exp })).toString('base64url');
  assert.equal(verifyToken(`wt1.${forged}.${sig}`, secret), null);
  assert.equal(verifyToken(`wt1.${body}.${sig}x`, secret), null);
  assert.equal(verifyToken(token, Buffer.from('otro-secreto-otro-secreto-otro!!')), null);
  assert.equal(verifyToken(token, secret, (exp + 1) * 1000), null);
  assert.equal(verifyToken('basura', secret), null);
});

test('authenticate y create: usan el repositorio y nunca guardan la clave en claro', async () => {
  const stored: Array<{ hash: string; prefix: string }> = [];
  let active = 0;
  const touched: string[] = [];
  const repo = {
    countActive: async () => active,
    create: async (input: { hash: string; prefix: string; name: string }) => {
      stored.push(input);
      return { id: 'k1', name: input.name, prefix: input.prefix, last4: 'xxxx', created_at: '', last_used_at: null, revoked_at: null };
    },
    findByHash: async (hash: string) =>
      stored.some((s) => s.hash === hash) ? { id: 'k1', companyId: 'c1', projectId: 'p1', revoked: false } : null,
    touch: (id: string) => void touched.push(id),
  };
  const chatbots = { findByProject: async () => null };
  const svc = new ApiKeysService(repo as never, chatbots as never, { widgetTokenSecret: 'x'.repeat(32) } as never);

  const created = await svc.create({ id: 'p1', companyId: 'c1' }, '  Servidor  ', 'u1');
  assert.equal(created.name, 'Servidor');
  assert.ok(!JSON.stringify(stored).includes(created.key), 'solo se guarda el hash');
  const ctx = await svc.authenticate(`Bearer ${created.key}`);
  assert.deepEqual([ctx.keyId, ctx.projectId, touched], ['k1', 'p1', ['k1']]);

  await assert.rejects(svc.authenticate('Bearer sk_live_' + 'a'.repeat(43)), InvalidApiKeyError);
  await assert.rejects(svc.authenticate(undefined), InvalidApiKeyError);
  active = MAX_ACTIVE_KEYS;
  await assert.rejects(svc.create({ id: 'p1', companyId: 'c1' }, 'otra', 'u1'), InvalidInputError);
});
