/**
 * Show what one person has left of this month's AI budget, or top them up.
 *
 * A top-up raises that person's allowance for the current month and nobody
 * else's. It never lifts the global cap, and it never rewrites what was spent:
 * spend stays exactly what Anthropic billed.
 *
 * Usage: node scripts/ai-topup.js '<userId>'                 (show only)
 *        node scripts/ai-topup.js '<userId>' <dollars>       (top up)
 *        REDIS_URL=redis://localhost:6379 node scripts/ai-topup.js '<userId>' 1
 *        railway run -s Redis -- node scripts/ai-topup.js '<userId>' 1     (production)
 *
 * Quote the user id: provider ids contain `|`, which the shell reads as a pipe.
 * The limits are read from the same variables as the server, so run it with
 * the environment the server has, or the "left" figure is computed against the
 * defaults.
 */

import Redis from 'ioredis';

import { opsRedisUrl } from '../src/ops/redisTarget.js';
import { createSpendLedger, ledgerLimits } from '../src/ai/spend.js';

const [userId, amount] = process.argv.slice(2);

if (!userId) {
  console.error("usage: node scripts/ai-topup.js '<userId>' [dollars]");
  process.exit(2);
}

const describe = (left) =>
  `$${left.user.toFixed(2)} of $${left.userQuota.toFixed(2)} left in ${left.period}` +
  ` (everyone: $${left.global.toFixed(2)} of $${left.globalCap.toFixed(2)})`;

let host;
try {
  const redis = new Redis(opsRedisUrl(process.env), { family: 0, maxRetriesPerRequest: 2 });
  host = `${redis.options.host}:${redis.options.port}`;
  console.error(`using ${host}`);

  try {
    const ledger = createSpendLedger(redis, ledgerLimits(process.env));
    console.log(`before: ${describe(await ledger.remaining(userId))}`);

    if (amount !== undefined) {
      await ledger.grant(userId, Number(amount));
      console.log(`after:  ${describe(await ledger.remaining(userId))}`);
    }
  } finally {
    redis.disconnect();
  }
} catch (error) {
  console.error(host ? `${host}: ${error.message}` : error.message);
  process.exit(1);
}
