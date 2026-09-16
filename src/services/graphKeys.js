/**
 * Every graph is stored at user:<userId>:graph:<graphId>. Jobs that act on
 * every user find their graphs here — with SCAN, never KEYS, which blocks
 * Redis while it walks the whole keyspace.
 */

const GRAPH_KEY = /^user:([^:]+):graph:([^:]+)$/;

export function parseGraphKey(key) {
  const match = GRAPH_KEY.exec(key);
  return match ? { userId: match[1], graphId: match[2] } : null;
}

export async function* scanGraphKeys(redis, { count = 200 } = {}) {
  // SCAN may return a key more than once over a full iteration.
  const seen = new Set();
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'user:*:graph:*', 'COUNT', count);
    cursor = next;
    for (const key of keys) {
      const graph = parseGraphKey(key);
      if (graph && !seen.has(key)) {
        seen.add(key);
        yield { key, ...graph };
      }
    }
  } while (cursor !== '0');
}
