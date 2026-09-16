/**
 * The midnight habit counter.
 *
 * Ticking a repeatable node only flips isDone; the day is counted here, once,
 * at midnight: every ticked repeatable — bounded or infinity — gets one more
 * completion and starts the next day unticked. A bounded habit's progress is
 * currentCompletions / requiredCompletions, so without this it never moves.
 *
 * Each change is an ordinary UPDATE_NODE through the graph's operation queue:
 * it cannot interleave with an edit the person is making, it is journalled,
 * and it is broadcast to their open tabs — a tab still holding the old count
 * would otherwise write it back on its next click.
 */

import { logger } from '../utils/logger.js';

export function habitUpdates(graph) {
  const updates = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node.nodeType === 'repeatable' && node.isDone === true) {
        updates.push({
          id: node.id,
          updates: { currentCompletions: (node.currentCompletions || 0) + 1, isDone: false },
        });
      }
      walk(node.children);
    }
  };
  walk(graph?.nodes);
  return updates;
}

export async function runHabitCounter({ graphs, getGraph, applyOperation, broadcast, log = logger }) {
  const result = { graphs: 0, nodes: 0, failed: 0 };

  for await (const { userId, graphId } of graphs) {
    result.graphs++;
    try {
      // Read outside the queue: a habit unticked in the very instant of
      // midnight can still be counted. The window is milliseconds wide.
      const graph = await getGraph(graphId, userId);
      for (const { id, updates } of habitUpdates(graph)) {
        const operation = { type: 'UPDATE_NODE', payload: { id, updates } };
        if (!(await applyOperation(graphId, operation, userId))) continue;

        result.nodes++;
        broadcast({ userId, graphId }, {
          type: 'OPERATION_APPLIED',
          payload: operation,
          userId,
          clientId: 'server',
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      result.failed++;
      log.error(`Habit counter failed for ${userId}:${graphId}: ${error.message}`);
    }
  }

  return result;
}
