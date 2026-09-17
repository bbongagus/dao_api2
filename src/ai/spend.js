/**
 * What each person has spent on AI this month, and what is left.
 *
 * A turn is refused before any API call when either the person's quota or the
 * global cap is gone. The cost of a turn is only known once it has run, so the
 * turn that crosses the line overshoots by its own cost — deliberately, because
 * the alternative is reserving an estimate and refunding it, which is a great
 * deal more machinery for a beta.
 */

/** Two months is long enough to answer "what did I spend in September?" and short enough not to pile up. */
const KEEP_SECONDS = 62 * 24 * 60 * 60;

/**
 * The calendar month a moment belongs to, in UTC.
 *
 * UTC and not Europe/Belgrade: a month boundary has no meaning to a person the
 * way a day boundary does, and the habit counter's local midnight is already
 * one definition of "today" too many.
 */
export function spendPeriod(at = new Date()) {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Keys are `<namespace>:user:<userId>:<period>` and `<namespace>:global:<period>`.
 * The `user`/`global` segment keeps a person who signs up as "global" from
 * colliding with the cap, and lets a test have a namespace of its own.
 */
export const DEFAULT_NAMESPACE = 'ai:spend';

/**
 * @param {import('ioredis').Redis} redis
 * @param {{ userQuota: number, globalCap: number, namespace?: string }} limits — dollars per month.
 */
export function createSpendLedger(redis, { userQuota, globalCap, namespace = DEFAULT_NAMESPACE }) {
  const userKey = (userId, period) => `${namespace}:user:${userId}:${period}`;
  const globalKey = (period) => `${namespace}:global:${period}`;
  /** Both counters move together, so a turn is never charged to one and not the other. */
  async function record(userId, dollars, at = new Date()) {
    if (!(dollars > 0)) return;
    const period = spendPeriod(at);

    const pipeline = redis.pipeline();
    pipeline.incrbyfloat(userKey(userId, period), dollars);
    pipeline.expire(userKey(userId, period), KEEP_SECONDS);
    pipeline.incrbyfloat(globalKey(period), dollars);
    pipeline.expire(globalKey(period), KEEP_SECONDS);
    await pipeline.exec();
  }

  async function spent(userId, at = new Date()) {
    const period = spendPeriod(at);
    const [mine, everyone] = await redis.mget(userKey(userId, period), globalKey(period));
    return { user: Number(mine) || 0, global: Number(everyone) || 0, period };
  }

  /** What is left, floored at zero: an overshoot is not a debt to carry forward. */
  async function remaining(userId, at = new Date()) {
    const used = await spent(userId, at);
    return {
      user: Math.max(0, userQuota - used.user),
      global: Math.max(0, globalCap - used.global),
      period: used.period,
      userQuota,
      globalCap,
    };
  }

  /**
   * Whether a turn may start. The global cap is reported first: a person with
   * quota left should be told the service is closed, not that they are.
   */
  async function check(userId, at = new Date()) {
    const left = await remaining(userId, at);
    if (left.global <= 0) return { allowed: false, scope: 'global', ...left };
    if (left.user <= 0) return { allowed: false, scope: 'user', ...left };
    return { allowed: true, ...left };
  }

  return { record, remaining, check, spent };
}
