/**
 * Remove every Kata from every stored graph. Dry run unless --apply.
 *
 * Writes each changed key directly, outside the server's per-graph queue: run
 * it when nobody is editing, or a whole-graph save from an open tab can put a
 * Kata back. Take a backup first (scripts/redis-backup.js).
 *
 * Usage: REDIS_URL=redis://localhost:6379 node scripts/remove-kata.js [--apply]
 *        railway run -s Redis -- node scripts/remove-kata.js [--apply]   (production)
 */

import Redis from 'ioredis';

import { opsRedisUrl } from '../src/ops/redisTarget.js';
import { maskUserId } from '../src/ops/census.js';
import { removeKata } from '../src/ops/removeKata.js';
import { scanGraphKeys } from '../src/services/graphKeys.js';

const apply = process.argv.includes('--apply');

let host;
try {
  const redis = new Redis(opsRedisUrl(process.env), { family: 0, maxRetriesPerRequest: 2 });
  host = `${redis.options.host}:${redis.options.port}`;
  console.error(`${apply ? 'writing' : 'dry run, reading'} ${host}`);
  try {
    let graphs = 0;
    let nodes = 0;
    for await (const { key, userId, graphId } of scanGraphKeys(redis)) {
      const raw = await redis.get(key);
      if (raw === null) continue;
      let result;
      try {
        result = removeKata(JSON.parse(raw));
      } catch {
        console.log(`${maskUserId(userId)} ${graphId}: unparseable, skipped`);
        continue;
      }
      if (result.removedIds.length === 0) continue;
      graphs += 1;
      nodes += result.removedIds.length;
      console.log(`${maskUserId(userId)} ${graphId}: ${result.removedIds.length} nodes, ${result.edgesRemoved} edges`);
      if (apply) await redis.set(key, JSON.stringify(result.graph), 'KEEPTTL');
    }
    console.log(`${apply ? 'removed' : 'would remove'} ${nodes} nodes in ${graphs} graphs`);
  } finally {
    redis.disconnect();
  }
} catch (error) {
  // Never the error object: ioredis attaches the failing command and its key.
  console.error(host ? `${host}: ${error.message}` : error.message);
  process.exit(1);
}
