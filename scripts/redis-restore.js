/**
 * Load a backup made by redis-backup.js into an empty local Redis — for a
 * rehearsal. It refuses any other target.
 *
 * Usage: REDIS_URL=redis://localhost:6390 node scripts/redis-restore.js ~/dao-backups/2026-09-17/keys.jsonl
 */

import { readFileSync } from 'node:fs';
import Redis from 'ioredis';

import { restoreRefusal } from '../src/ops/redisTarget.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: REDIS_URL=redis://localhost:<port> node scripts/redis-restore.js <keys.jsonl>');
  process.exit(1);
}

// REDIS_PUBLIC_URL is ignored on purpose: under `railway run` it is production.
const url = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(url, { family: 0, maxRetriesPerRequest: 2 });
try {
  const refusal = restoreRefusal({ url, keyCount: await redis.dbsize() });
  if (refusal) {
    console.error(refusal);
    process.exitCode = 1;
  } else {
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const { key, pttl, dump } = JSON.parse(line);
      await redis.restore(key, pttl > 0 ? pttl : 0, Buffer.from(dump, 'base64'));
    }
    console.log(`${lines.length} keys restored into ${new URL(url).host}`);
  }
} finally {
  redis.disconnect();
}
