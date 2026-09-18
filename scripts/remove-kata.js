/**
 * Remove every Kata from every stored graph. Dry run unless --apply.
 *
 * Writes outside the server's per-graph queue. Each key is WATCHed and written
 * in a MULTI/EXEC, so a save that lands between the read and the write is not
 * overwritten: that graph is skipped and reported, and running again picks it
 * up. A tab still holding the old graph can put a Kata back with a later
 * whole-graph save, so run it when nobody is editing. Take a backup first
 * (scripts/redis-backup.js).
 *
 * Usage: REDIS_URL=redis://localhost:6379 node scripts/remove-kata.js [--apply]
 *        railway run -s Redis -- node scripts/remove-kata.js [--apply]   (production)
 */

import Redis from 'ioredis';

import { opsRedisUrl } from '../src/ops/redisTarget.js';
import { maskUserId } from '../src/ops/census.js';
import { removeKataAt } from '../src/ops/removeKataAt.js';
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
    let skipped = 0;
    for await (const { key, userId, graphId } of scanGraphKeys(redis)) {
      const graph = `${maskUserId(userId)} ${graphId}`;
      const { outcome, removed, edgesRemoved } = await removeKataAt(redis, key, { apply });
      if (outcome === 'unparseable') {
        console.log(`${graph}: unparseable, skipped`);
      } else if (outcome === 'raced') {
        skipped += 1;
        console.log(`${graph}: changed while reading, skipped — run again`);
      } else if (outcome === 'changed' || outcome === 'would-change') {
        graphs += 1;
        nodes += removed;
        console.log(`${graph}: ${removed} nodes, ${edgesRemoved} edges`);
      }
    }
    const summary = `${apply ? 'removed' : 'would remove'} ${nodes} nodes in ${graphs} graphs`;
    console.log(apply ? `${summary}, skipped ${skipped} that changed while reading` : summary);
  } finally {
    redis.disconnect();
  }
} catch (error) {
  // Never the error object: ioredis attaches the failing command and its key.
  console.error(host ? `${host}: ${error.message}` : error.message);
  process.exit(1);
}
