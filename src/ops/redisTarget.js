/**
 * Which Redis an operations script talks to, and where a restore may write.
 *
 * Under `railway run -s Redis` the environment carries both the private host
 * (redis.railway.internal, unreachable from a laptop) and REDIS_PUBLIC_URL.
 * src/redis.js prefers the private host, so the scripts do not use it.
 */

export function opsRedisUrl(env) {
  return env.REDIS_PUBLIC_URL || env.REDIS_URL || 'redis://localhost:6379';
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Why a restore must not run, or null when it may. */
export function restoreRefusal({ url, keyCount }) {
  const { hostname } = new URL(url);
  if (!LOCAL_HOSTS.has(hostname)) {
    return `refusing to restore into ${hostname}: only a local Redis can be a restore target`;
  }
  if (keyCount > 0) {
    return `refusing to restore into a Redis that already holds ${keyCount} keys`;
  }
  return null;
}
