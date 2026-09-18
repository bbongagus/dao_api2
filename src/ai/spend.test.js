import { test } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';

import { createSpendLedger, spendPeriod, ledgerLimits } from './spend.js';

/** Money never compares exactly after a round trip through Redis. */
const near = (actual, expected, what) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} is not ${expected}`);

const stamp = Date.now();
let seq = 0;
const someone = () => `spend-test-${stamp}-${seq++}`;

// Probe once, the way journal.test.js does: a bare `new Redis()` retries for
// minutes when nothing is listening, and takes the whole run down with it.
const probe = new Redis({ lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
const redisUp = await probe.connect().then(() => true, () => false);
if (redisUp) await probe.quit(); else probe.disconnect();
const needsRedis = { skip: !redisUp && 'no Redis on localhost' };

/** A ledger on the local Redis, cleaned up when the test ends. */
function ledgerFor(t, options = {}) {
  const redis = new Redis({ maxRetriesPerRequest: 1, retryStrategy: () => null });
  // Its own namespace, because the global counter is shared by everyone in a
  // month — without this, one test's spending shows up in the next one's cap.
  const namespace = `ai-spend-test:${stamp}:${seq++}`;
  t.after(async () => {
    const keys = [];
    for await (const batch of redis.scanStream({ match: `${namespace}:*`, count: 200 })) keys.push(...batch);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });
  return {
    ledger: createSpendLedger(redis, { userQuota: 2, globalCap: 25, namespace, ...options }),
    redis,
    namespace,
    track: (user) => user,
  };
}

test('a period is the calendar month in UTC', () => {
  assert.equal(spendPeriod(new Date('2026-09-17T21:30:00Z')), '2026-09');
  assert.equal(spendPeriod(new Date('2026-12-31T23:59:59Z')), '2026-12');
  // An hour later in Belgrade is already January; the period is not.
  assert.equal(spendPeriod(new Date('2026-12-31T23:00:00Z')), '2026-12');
  assert.equal(spendPeriod(new Date('2027-01-01T00:00:00Z')), '2027-01');
});

test('what a user spends comes off their quota and the global cap alike', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t);
  const user = track(someone());

  await ledger.record(user, 0.25);
  const left = await ledger.remaining(user);

  near(left.user, 1.75, 'user');
  near(left.global, 24.75, 'global');
});

test("one user's spending is invisible to another, but both draw down the cap", needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t);
  const a = track(someone());
  const b = track(someone());

  await ledger.record(a, 1);
  await ledger.record(b, 0.5);

  near((await ledger.remaining(a)).user, 1, "a's quota");
  near((await ledger.remaining(b)).user, 1.5, "b's quota");
  near((await ledger.remaining(a)).global, 23.5, 'the cap counts both');
});

test('a turn is allowed while the user has room', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t);
  const user = track(someone());

  await ledger.record(user, 1.99);

  assert.equal((await ledger.check(user)).allowed, true);
});

test('a user over their quota is refused, and told it was theirs', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t);
  const user = track(someone());

  await ledger.record(user, 2);
  const verdict = await ledger.check(user);

  assert.equal(verdict.allowed, false);
  assert.equal(verdict.scope, 'user');
});

test('the global cap refuses a user who still has quota of their own', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t, { globalCap: 1 });
  const user = track(someone());

  await ledger.record(user, 1);
  const verdict = await ledger.check(user);

  assert.equal(verdict.allowed, false);
  assert.equal(verdict.scope, 'global');
  near((await ledger.remaining(user)).user, 1, 'their own quota is untouched');
});

test('remaining never goes negative — the last turn may overshoot', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t);
  const user = track(someone());

  await ledger.record(user, 5);

  near((await ledger.remaining(user)).user, 0, 'floored at zero');
});

test('a new month starts clean', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t);
  const user = track(someone());

  await ledger.record(user, 2, new Date('2026-09-17T12:00:00Z'));

  near((await ledger.remaining(user, new Date('2026-09-17T12:00:00Z'))).user, 0, 'September');
  near((await ledger.remaining(user, new Date('2026-10-01T00:00:00Z'))).user, 2, 'October');
});

test("a month's counters expire, so old months do not pile up in Redis", needsRedis, async (t) => {
  const { ledger, redis, namespace, track } = ledgerFor(t);
  const user = track(someone());

  await ledger.record(user, 0.1);
  const ttl = await redis.ttl(`${namespace}:user:${user}:${spendPeriod()}`);

  assert.ok(ttl > 0, `expected an expiry, got ttl=${ttl}`);
});

// --- topping someone up ---

test('a grant raises one person\'s allowance for the month, and nobody else\'s', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t);
  const lucky = track(someone());
  const other = track(someone());

  await ledger.record(lucky, 2);
  assert.equal((await ledger.check(lucky)).allowed, false, 'out of quota before the grant');

  await ledger.grant(lucky, 3);

  near((await ledger.remaining(lucky)).user, 3, 'the grant is on top of a spent quota');
  assert.equal((await ledger.check(lucky)).allowed, true);
  near((await ledger.remaining(other)).user, 2, 'someone else is untouched');
});

test('a grant does not rewrite what was spent — the spend stays the truth', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t);
  const user = track(someone());

  await ledger.record(user, 1.5);
  await ledger.grant(user, 5);

  near((await ledger.spent(user)).user, 1.5, 'spend is what Anthropic billed, whatever was granted');
});

test('a grant does not lift the global cap', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t, { globalCap: 1 });
  const user = track(someone());

  await ledger.record(user, 1);
  await ledger.grant(user, 10);

  assert.equal((await ledger.check(user)).scope, 'global');
});

test('a grant belongs to its month', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t);
  const user = track(someone());

  await ledger.grant(user, 4, new Date('2026-09-10T00:00:00Z'));

  near((await ledger.remaining(user, new Date('2026-10-02T00:00:00Z'))).user, 2, 'October starts from the plain quota');
});

test('a grant that is not a positive amount is refused', needsRedis, async (t) => {
  const { ledger, track } = ledgerFor(t);
  const user = track(someone());

  await assert.rejects(ledger.grant(user, 0), /positive/);
  await assert.rejects(ledger.grant(user, -5), /positive/);
  await assert.rejects(ledger.grant(user, Number.NaN), /positive/);
});

// --- where the limits come from ---

test('the limits default to a small quota and a small cap', () => {
  assert.deepEqual(ledgerLimits({}), { userQuota: 2, globalCap: 25 });
});

test('the limits are read from the environment', () => {
  assert.deepEqual(
    ledgerLimits({ AI_USER_MONTHLY_QUOTA_USD: '0.5', AI_GLOBAL_MONTHLY_CAP_USD: '100' }),
    { userQuota: 0.5, globalCap: 100 },
  );
});

test('a mistyped limit stops the server rather than opening the tap', () => {
  // Number('two') is NaN, and NaN <= 0 is false — so a NaN quota never reads
  // as exhausted, and every turn would have been allowed for ever.
  assert.throws(() => ledgerLimits({ AI_USER_MONTHLY_QUOTA_USD: 'two' }), /AI_USER_MONTHLY_QUOTA_USD/);
  assert.throws(() => ledgerLimits({ AI_GLOBAL_MONTHLY_CAP_USD: '25$' }), /AI_GLOBAL_MONTHLY_CAP_USD/);
  assert.throws(() => ledgerLimits({ AI_USER_MONTHLY_QUOTA_USD: '-1' }), /AI_USER_MONTHLY_QUOTA_USD/);
  assert.throws(() => ledgerLimits({ AI_GLOBAL_MONTHLY_CAP_USD: 'Infinity' }), /AI_GLOBAL_MONTHLY_CAP_USD/);
});

test('zero is a legitimate limit: AI switched off for everyone', () => {
  assert.deepEqual(ledgerLimits({ AI_GLOBAL_MONTHLY_CAP_USD: '0' }), { userQuota: 2, globalCap: 0 });
});

test('a ledger itself refuses a limit that is not a number', () => {
  assert.throws(() => createSpendLedger({}, { userQuota: Number.NaN, globalCap: 25 }), /userQuota/);
});
