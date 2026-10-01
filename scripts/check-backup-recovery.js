/** Rehearse with synthetic data in two empty local databases; never production data. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { restoreRefusal } from '../src/ops/redisTarget.js';
import { collectBackup, sealBackup, openBackup, restoreBackup } from '../src/ops/backupArchive.js';
const urls = process.argv.slice(2);
if (urls.length !== 2 || urls[0] === urls[1]) throw new Error('Pass two different, empty local Redis URLs');
const clients = urls.map((url) => new Redis(url, { lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 1 }));
const keys = ['rehearsal:graph', 'rehearsal:list', 'rehearsal:hash', 'rehearsal:stream', 'rehearsal:expires'];
let owned = false;
try {
  for (const client of clients) {
    client.on('error', () => {});
    assert.equal(restoreRefusal({ host: client.options.host, keyCount: null }), null);
  }
  assert.notEqual(`${clients[0].options.host}:${clients[0].options.port}/${clients[0].options.db}`, `${clients[1].options.host}:${clients[1].options.port}/${clients[1].options.db}`);
  for (const client of clients) { await client.connect(); assert.equal(await client.dbsize(), 0); }
  owned = true;
  const [source, target] = clients;
  await source.set(keys[0], JSON.stringify({ nodes: [{ id: 'task', title: 'Example', isDone: true }], edges: [] }));
  await source.rpush(keys[1], 'one', 'two');
  await source.hset(keys[2], 'field', 'value');
  await source.xadd(keys[3], '*', 'operation', 'done');
  await source.set(keys[4], 'temporary', 'PX', 60000);
  const key = randomBytes(32);
  const archive = openBackup(sealBackup(await collectBackup(source), key), key);
  assert.deepEqual(await restoreBackup(target, archive), { restored: 5, expired: 0 });
  for (const name of keys) assert.deepEqual(await target.dumpBuffer(name), await source.dumpBuffer(name));
  const ttl = await target.pttl(keys[4]);
  assert(ttl > 0 && ttl <= 60000);
  await assert.rejects(() => restoreBackup(target, archive));
  console.log('Recovery rehearsal passed: graph, list, hash, journal stream, TTL, and non-empty-target refusal.');
} finally {
  if (owned) await Promise.all(clients.map((client) => client.del(...keys).catch(() => {})));
  clients.forEach((client) => client.disconnect());
}
