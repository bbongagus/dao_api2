/**
 * Rewrite one stored graph outside the server's queue, safely — for the
 * operations scripts (remove-kata, prune-orphan-edges).
 *
 * With `apply`, the key is WATCHed before it is read and written back in a
 * MULTI/EXEC, so a save that lands between the read and the write is never
 * overwritten: EXEC answers null, nothing is written, and the graph comes
 * back as 'raced' for the caller to report and run again. A dry run only reads.
 *
 * `transform(graph)` returns `{ graph, counts }` when it would change
 * something, or null when the graph is fine as it is.
 *
 * The client is passed in, so this is tested without Redis.
 *
 * @returns {Promise<{ outcome: 'unchanged' | 'unparseable' | 'would-change' | 'changed' | 'raced',
 *                     counts: object|null }>}
 */
export async function rewriteGraphAt(redis, key, transform, { apply = false } = {}) {
  if (apply) await redis.watch(key);
  let watching = apply;
  try {
    const raw = await redis.get(key);
    if (raw === null) return { outcome: 'unchanged', counts: null }; // gone since the scan

    let result;
    try {
      result = transform(JSON.parse(raw));
    } catch {
      return { outcome: 'unparseable', counts: null };
    }
    if (!result) return { outcome: 'unchanged', counts: null };
    if (!apply) return { outcome: 'would-change', counts: result.counts };

    const replies = await redis.multi().set(key, JSON.stringify(result.graph), 'KEEPTTL').exec();
    watching = false; // EXEC ends the WATCH, whatever it answers
    if (replies === null) return { outcome: 'raced', counts: null };
    const [error] = replies[0] || [];
    if (error) throw error;
    return { outcome: 'changed', counts: result.counts };
  } finally {
    if (watching) await redis.unwatch();
  }
}
