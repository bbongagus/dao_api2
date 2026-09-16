/**
 * Load a backup made by redis-backup.js into an empty local Redis — for a
 * rehearsal. It refuses any other target.
 *
 * Usage: REDIS_URL=redis://localhost:6390 node scripts/redis-restore.js ~/dao-backups/2026-09-17/keys.jsonl
 */

import { readFileSync } from 'node:fs';
import Redis from 'ioredis';

import { restoreRefusal } from '../src/ops/redisTarget.js';

const usage = 'Usage: REDIS_URL=redis://localhost:<port> node scripts/redis-restore.js <keys.jsonl>';

const file = process.argv[2];
if (!file) {
  console.error(usage);
  process.exit(1);
}

// REDIS_PUBLIC_URL is ignored on purpose: under `railway run` it is production.
const url = process.env.REDIS_URL;
if (!url) {
  console.error(usage);
  process.exit(1);
}

let host; // set once the client exists, so the catch below can name the target
try {
  const redis = new Redis(url, { family: 0, maxRetriesPerRequest: 2, lazyConnect: true });
  host = redis.options.host;
  console.error(`restoring into ${host}:${redis.options.port}`);

  // Judged on the host alone, before any connection is attempted: a bad
  // target is refused instantly, with no AUTH or DBSIZE sent anywhere.
  const refusalBeforeConnect = restoreRefusal({ host, keyCount: null });
  if (refusalBeforeConnect) {
    console.error(refusalBeforeConnect);
    process.exit(1);
  }

  try {
    await redis.connect();
    const keyCount = await redis.dbsize();
    const refusal = restoreRefusal({ host, keyCount });
    if (refusal) {
      console.error(refusal);
      process.exitCode = 1;
    } else {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const { key, pttl, dump } = JSON.parse(line);
        await redis.restore(key, pttl > 0 ? pttl : 0, Buffer.from(dump, 'base64'));
      }
      console.log(`${lines.length} keys restored into ${host}:${redis.options.port}`);
    }
  } finally {
    redis.disconnect();
  }
} catch (error) {
  // Never the error object: ioredis attaches the failing command, which for
  // a RESTORE would put a raw `user:<id>:graph:<id>` key on the operator's screen.
  console.error(host ? `${host}: ${error.message}` : error.message);
  process.exit(1);
}
