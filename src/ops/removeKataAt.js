/**
 * One stored graph through removeKata, for scripts/remove-kata.js.
 *
 * With `apply`, the key is WATCHed before it is read and written back in a
 * MULTI/EXEC, so a save that lands between the read and the write is never
 * overwritten: EXEC answers null, nothing is written, and the graph comes
 * back as 'raced' for the caller to report and run again. A dry run only reads.
 *
 * The client is passed in, so this is tested without Redis.
 *
 * @returns {Promise<{ outcome: 'unchanged' | 'unparseable' | 'would-change' | 'changed' | 'raced',
 *                     removed: number, edgesRemoved: number }>}
 */

import { removeKata } from './removeKata.js';

const nothing = (outcome) => ({ outcome, removed: 0, edgesRemoved: 0 });

export async function removeKataAt(redis, key, { apply = false } = {}) {
  if (apply) await redis.watch(key);
  let watching = apply;
  try {
    const raw = await redis.get(key);
    if (raw === null) return nothing('unchanged'); // gone since the scan

    let result;
    try {
      result = removeKata(JSON.parse(raw));
    } catch {
      return nothing('unparseable');
    }
    if (result.removedIds.length === 0) return nothing('unchanged');

    const counts = { removed: result.removedIds.length, edgesRemoved: result.edgesRemoved };
    if (!apply) return { outcome: 'would-change', ...counts };

    const replies = await redis.multi().set(key, JSON.stringify(result.graph), 'KEEPTTL').exec();
    watching = false; // EXEC ends the WATCH, whatever it answers
    if (replies === null) return nothing('raced');
    const [error] = replies[0] || [];
    if (error) throw error;
    return { outcome: 'changed', ...counts };
  } finally {
    if (watching) await redis.unwatch();
  }
}
