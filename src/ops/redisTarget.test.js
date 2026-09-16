import { test } from 'node:test';
import assert from 'node:assert/strict';

import { opsRedisUrl, restoreRefusal } from './redisTarget.js';

test('the public URL wins, then REDIS_URL', () => {
  assert.equal(opsRedisUrl({ REDIS_PUBLIC_URL: 'redis://pub:1', REDIS_URL: 'redis://priv:2' }), 'redis://pub:1');
  assert.equal(opsRedisUrl({ REDIS_URL: 'redis://priv:2' }), 'redis://priv:2');
});

test('throws when neither is set', () => {
  assert.throws(() => opsRedisUrl({}), /there is no default Redis/);
});

test('a restore only ever goes into an empty local Redis', () => {
  assert.equal(restoreRefusal({ host: 'localhost', keyCount: 0 }), null);
  assert.equal(restoreRefusal({ host: '127.0.0.1', keyCount: 0 }), null);
  assert.equal(restoreRefusal({ host: '::1', keyCount: 0 }), null);
  assert.match(restoreRefusal({ host: 'shortline.proxy.rlwy.net', keyCount: 0 }), /only a local Redis/);
  assert.match(restoreRefusal({ host: 'localhost.example.com', keyCount: 0 }), /only a local Redis/);
  assert.match(restoreRefusal({ host: 'localhost', keyCount: 43 }), /already holds 43 keys/);
});

test('a null keyCount judges only the host, for the check before a connection exists', () => {
  assert.equal(restoreRefusal({ host: 'localhost', keyCount: null }), null);
  assert.match(restoreRefusal({ host: 'shortline.proxy.rlwy.net', keyCount: null }), /only a local Redis/);
});

test('a refusal never repeats a password', () => {
  assert.doesNotMatch(restoreRefusal({ host: 'shortline.proxy.rlwy.net', keyCount: 0 }), /secret/);
});
