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

const redis = new Redis(opsRedisUrl(process.env), { family: 0, maxRetriesPerRequest: 2 });
try {
  process.stdout.write(await takeCensus(redis));
} finally {
  redis.disconnect();
}
