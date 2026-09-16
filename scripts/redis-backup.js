/**
 * Copy every key of a Redis into a new directory: keys.jsonl (one DUMP per
 * key, with its type and remaining TTL) and census.txt (see graph-census.js).
 *
 * Usage: railway run -s Redis -- node scripts/redis-backup.js ~/dao-backups/2026-09-17
 *
 * Read-only on the source. The directory must not exist yet, so a backup is
 * never overwritten. It holds other people's goals — keep it out of git.
 */

import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';

import { opsRedisUrl } from '../src/ops/redisTarget.js';
import { takeCensus } from '../src/ops/census.js';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/redis-backup.js <new directory>');
  process.exit(1);
}
if (existsSync(dir)) {
  console.error(`${dir} already exists; a backup is never overwritten`);
  process.exit(1);
}

let host; // set once the client exists, so a catch below can name the target
try {
  const redis = new Redis(opsRedisUrl(process.env), { family: 0, maxRetriesPerRequest: 2 });
  host = `${redis.options.host}:${redis.options.port}`;
  console.error(`reading ${host}`);
  try {
    // Other people's goals: only the operator who ran this should be able to read it.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const out = createWriteStream(join(dir, 'keys.jsonl'));
    const seen = new Set();
    let bytes = 0;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'COUNT', 500);
      cursor = next;
      for (const key of keys) {
        if (seen.has(key)) continue;
        const [dump, pttl, type] = await Promise.all([redis.dumpBuffer(key), redis.pttl(key), redis.type(key)]);
        if (dump === null) continue; // expired between SCAN and DUMP
        seen.add(key);
        out.write(JSON.stringify({ key, type, pttl, dump: dump.toString('base64') }) + '\n');
        bytes += dump.length;
      }
    } while (cursor !== '0');
    await new Promise((resolve) => out.end(resolve));
    writeFileSync(join(dir, 'census.txt'), await takeCensus(redis));
    console.log(`${seen.size} keys, ${bytes} bytes of DUMP payload from ${host} → ${dir}`);
  } finally {
    redis.disconnect();
  }
} catch (error) {
  // Never the error object: ioredis attaches the failing command, which for
  // a GET would put a raw `user:<id>:graph:<id>` key on the operator's screen.
  console.error(host ? `${host}: ${error.message}` : error.message);
  process.exit(1);
}
