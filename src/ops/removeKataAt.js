/**
 * One stored graph through removeKata, for scripts/remove-kata.js. The safe
 * read-and-write-back is rewriteGraphAt's.
 *
 * @returns {Promise<{ outcome: 'unchanged' | 'unparseable' | 'would-change' | 'changed' | 'raced',
 *                     removed: number, edgesRemoved: number }>}
 */

import { removeKata } from './removeKata.js';
import { rewriteGraphAt } from './rewriteGraphAt.js';

export async function removeKataAt(redis, key, { apply = false } = {}) {
  const { outcome, counts } = await rewriteGraphAt(redis, key, (graph) => {
    const result = removeKata(graph);
    if (result.removedIds.length === 0) return null;
    return { graph: result.graph, counts: { removed: result.removedIds.length, edgesRemoved: result.edgesRemoved } };
  }, { apply });
  return { outcome, removed: counts?.removed ?? 0, edgesRemoved: counts?.edgesRemoved ?? 0 };
}
