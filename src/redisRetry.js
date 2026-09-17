/**
 * How long to wait before trying Redis again.
 *
 * Its own module so it can be tested without importing `redis.js`, which
 * connects on import.
 *
 * The policy is: never give up. Redis holds every graph, so a server that has
 * stopped reconnecting is a server that can do nothing useful — and it used to
 * stop after ten attempts, roughly fifteen seconds, then stay disconnected
 * until someone redeployed it. A restart of Redis on Railway takes longer than
 * that.
 */

/** Long enough not to hammer a Redis that is still booting, short enough that recovery feels immediate. */
export const MAX_RETRY_DELAY_MS = 2000;

const FIRST_DELAY_MS = 100;

/**
 * @param {number} times how many attempts have been made, 1 for the first.
 * @returns {number} milliseconds to wait — always a number, never null.
 */
export function redisRetryDelay(times) {
  return Math.min(times * FIRST_DELAY_MS, MAX_RETRY_DELAY_MS);
}

export default redisRetryDelay;
