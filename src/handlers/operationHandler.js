/**
 * Operation Handler - Refactored to use modular operations
 * Individual operations are in ./operations/ directory
 *
 * CRITICAL: Uses per-graph queue to prevent concurrent read-modify-write races.
 * Without this, rapid operations (e.g. creating 3 nodes quickly) would each read
 * the same graph version from Redis, and only the last save would survive.
 *
 * The operation runs INSIDE the promise chain (not after acquiring a lock),
 * making concurrent execution on the same graph physically impossible.
 *
 * Performance: Passes NodeIndex for O(1) lookups
 */

import { logger } from '../utils/logger.js';
import { routeOperation } from './operations/index.js';
import { describeOperation } from '../services/journal.js';
import { createGraphQueue } from './graphQueue.js';

// Per-graph operation queue: ensures operations for the same graph run
// sequentially. Exported so a shutdown can wait for it — see graphQueue.js.
export const graphQueue = createGraphQueue();
let operationSeq = 0; // Global sequence counter for debugging

/**
 * Create operation handler with dependencies
 * @param {Object} deps - Dependencies (getGraph, saveGraph, getNodeIndex, journal)
 */
export function createOperationHandler(deps) {
  const { getGraph, saveGraph, getNodeIndex, journal = null } = deps;

  /**
   * Execute a single operation (called from inside the queue)
   */
  async function executeOperation(graphId, operation, userId, seq) {
    const { type, payload } = operation;

    const graph = await getGraph(graphId, userId);
    if (!graph) {
      logger.error(`Graph ${graphId} not found for user ${userId}`);
      return null;
    }

    // Read before applying: the values an operation replaces are gone after.
    const change = journal ? describeOperation(graph, operation) : null;

    const nodeIndex = getNodeIndex ? getNodeIndex(graphId, userId) : null;
    const success = routeOperation(type, graph, payload, graphId, nodeIndex, userId);

    if (!success) {
      logger.error(`[QUEUE #${seq}] Operation ${type} failed`);
      return null;
    }

    await saveGraph(graphId, graph, userId);

    if (change) await journal.record(userId, graphId, { kind: 'operation', ...change });

    return graph;
  }

  /**
   * Apply operation to graph (serialized per graph via queue)
   * The operation is chained onto the graph's promise queue, so it CANNOT
   * start until the previous operation for the same graph has finished.
   */
  return function applyOperation(graphId, operation, userId) {
    // Every caller knows whose graph it changes. A missing user is a bug to
    // surface, not a reason to write into somebody else's graph.
    if (!userId) throw new Error(`applyOperation ${operation?.type} without a userId`);

    const lockKey = `${userId}:${graphId}`;
    const seq = ++operationSeq;

    return graphQueue.enqueue(lockKey, async () => {
      logger.info(`[QUEUE #${seq}] START ${operation.type} for ${lockKey}`);
      try {
        const result = await executeOperation(graphId, operation, userId, seq);
        logger.info(`[QUEUE #${seq}] DONE ${operation.type} for ${lockKey}`);
        return result;
      } catch (error) {
        // The Error itself, not its message in a string: logger.error only
        // reports an Error to Sentry. Never the payload — it holds titles.
        logger.error(`[QUEUE #${seq}] ERROR ${operation.type}:`, error);
        return null;
      }
    });
  };
}

export default createOperationHandler;
