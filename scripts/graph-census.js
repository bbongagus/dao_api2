/**
 * Print one line per stored graph: user (provider ids masked), graph, node
 * and edge counts, and a fingerprint of the stored JSON. Read-only.
 *
 * Usage: node scripts/graph-census.js
 *        REDIS_URL=redis://localhost:6390 node scripts/graph-census.js
 *        railway run -s Redis -- node scripts/graph-census.js      (production)
 */

import Redis from 'ioredis';

import { opsRedisUrl } from '../src/ops/redisTarget.js';
import { takeCensus } from '../src/ops/census.js';

let host; // set once the client exists, so a catch below can name the target
try {
  const redis = new Redis(opsRedisUrl(process.env), { family: 0, maxRetriesPerRequest: 2 });
  host = `${redis.options.host}:${redis.options.port}`;
  console.error(`reading ${host}`);
  try {
    process.stdout.write(await takeCensus(redis));
  } finally {
    redis.disconnect();
  }
} catch (error) {
  // Never the error object: ioredis attaches the failing command, which for
  // a GET would put a raw `user:<id>:graph:<id>` key on the operator's screen.
  console.error(host ? `${host}: ${error.message}` : error.message);
  process.exit(1);
}
