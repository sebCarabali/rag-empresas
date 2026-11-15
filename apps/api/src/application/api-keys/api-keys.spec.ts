import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { generateKey, hashKey, signToken, verifyToken } from './api-keys.service';

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
