import { test } from 'node:test';
import assert from 'node:assert/strict';

import { opsRedisUrl, restoreRefusal } from './redisTarget.js';

test('the public URL wins, then REDIS_URL, then the local default', () => {
  assert.equal(opsRedisUrl({ REDIS_PUBLIC_URL: 'redis://pub:1', REDIS_URL: 'redis://priv:2' }), 'redis://pub:1');
  assert.equal(opsRedisUrl({ REDIS_URL: 'redis://priv:2' }), 'redis://priv:2');
  assert.equal(opsRedisUrl({}), 'redis://localhost:6379');
});

test('a restore only ever goes into an empty local Redis', () => {
  assert.equal(restoreRefusal({ url: 'redis://localhost:6390', keyCount: 0 }), null);
  assert.equal(restoreRefusal({ url: 'redis://127.0.0.1:6390', keyCount: 0 }), null);
  assert.match(restoreRefusal({ url: 'redis://default:secret@shortline.proxy.rlwy.net:12345', keyCount: 0 }), /only a local Redis/);
  assert.match(restoreRefusal({ url: 'redis://localhost:6390', keyCount: 43 }), /already holds 43 keys/);
});

test('a refusal never repeats the password', () => {
  assert.doesNotMatch(restoreRefusal({ url: 'redis://default:secret@shortline.proxy.rlwy.net:12345', keyCount: 0 }), /secret/);
});
