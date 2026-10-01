import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { backupKey, sealBackup, openBackup, collectBackup, restoreBackup } from './backupArchive.js';
const key = randomBytes(32);
const row = (key, expiresAt = null) => ({ key, dump: Buffer.from('binary dump').toString('base64'), expiresAt });
const archive = { version: 1, createdAt: 100, entries: [row('graph')] };

test('encrypted archives round trip; encryption never writes titles in plaintext', () => {
  const bytes = sealBackup(archive, key);
  assert.deepEqual(openBackup(bytes, key), archive);
  assert.equal(bytes.includes(Buffer.from('graph')), false);
  assert.notDeepEqual(bytes, sealBackup(archive, key));
});
test('wrong keys, damaged archives and malformed payloads fail before restore', () => {
  assert.throws(() => backupKey('short'));
  assert.deepEqual(backupKey(key.toString('base64')), key);
  assert.throws(() => openBackup(sealBackup(archive, key), randomBytes(32)));
  const corrupt = sealBackup(archive, key); corrupt[40] ^= 1;
  assert.throws(() => openBackup(corrupt, key));
  for (const invalid of [{}, { ...archive, entries: [row('same'), row('same')] }, { ...archive, entries: [{ ...row('a'), expiresAt: -1 }] }]) {
    assert.throws(() => openBackup(sealBackup(invalid, key), key));
  }
});
test('capture deduplicates SCAN, skips expired keys and takes absolute lifetimes', async () => {
  const redis = {
    scan: async () => ['0', ['permanent', 'timed', 'gone', 'timed']],
    evalBuffer: async (_, __, name) => name === 'gone' ? [] : [Buffer.from(name), name === 'timed' ? 500 : -1],
  };
  const saved = await collectBackup(redis, () => 1000);
  assert.equal(saved.entries.length, 2);
  assert.equal(saved.entries[1].expiresAt, 1500);
});
test('restore never resurrects expired keys, never overwrites, and uses remaining TTL', async () => {
  const calls = [];
  const redis = { dbsize: async () => 0, restore: async (...args) => calls.push(args) };
  const result = await restoreBackup(redis, { entries: [row('permanent'), row('expired', 900), row('timed', 1500)] }, () => 1000);
  assert.deepEqual(result, { restored: 2, expired: 1 });
  assert.equal(calls[0][1], 0);
  assert.equal(calls[1][1], 500);
  assert.equal(calls.every((args) => args.length === 3), true);
  await assert.rejects(() => restoreBackup({ dbsize: async () => 1 }, archive));
});
