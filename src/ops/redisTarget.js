/**
 * Which Redis an operations script talks to, and where a restore may write.
 *
 * Under `railway run -s Redis` the environment carries both the private host
 * (redis.railway.internal, unreachable from a laptop) and REDIS_PUBLIC_URL.
 * src/redis.js prefers the private host, so the scripts do not use it.
 *
 * There is no default: every invocation must set REDIS_URL (local, or the
 * rehearsal's throwaway instance) or run under `railway run -s Redis`
 * (production, which sets REDIS_PUBLIC_URL too) — a silent fallback would let
 * a script meant for one Redis quietly read or write another.
 */

export function opsRedisUrl(env) {
  const url = env.REDIS_PUBLIC_URL || env.REDIS_URL;
  if (!url) {
    throw new Error('Set REDIS_URL (local) or run under `railway run -s Redis` (production) — there is no default Redis');
  }
  return url;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Why a restore must not run, or null when it may. `host` is the string
 * ioredis will actually dial (`redis.options.host`), never a URL to parse —
 * so this can never disagree with the client about where it is connecting.
 * `keyCount` may be `null` to mean "not counted yet": then only the host is
 * judged, for the check that must happen before a connection is made.
 */
export function restoreRefusal({ host, keyCount }) {
  if (!LOCAL_HOSTS.has(host)) {
    return `refusing to restore into ${host}: only a local Redis can be a restore target`;
  }
  if (keyCount !== null && keyCount > 0) {
    return `refusing to restore into a Redis that already holds ${keyCount} keys`;
  }
  return null;
}
