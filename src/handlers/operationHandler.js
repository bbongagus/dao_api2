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
import { DEFAULT_USER_ID } from '../services/graphService.js';

// Per-graph operation queue: ensures operations for the same graph run sequentially.
// Key: "userId:graphId", Value: Promise (tail of the queue)
const graphQueues = new Map();
let operationSeq = 0; // Global sequence counter for debugging

/**
 * Create operation handler with dependencies
 * @param {Object} deps - Dependencies (getGraph, saveGraph, addOperation, analytics, getNodeIndex)
 */
export function createOperationHandler(deps) {
  const { getGraph, saveGraph, addOperation, analytics, getNodeIndex } = deps;

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

    const nodeIndex = getNodeIndex ? getNodeIndex(graphId, userId) : null;
    const success = routeOperation(type, graph, payload, graphId, analytics, nodeIndex, userId);

    if (!success) {
      logger.error(`[QUEUE #${seq}] Operation ${type} failed`);
      return null;
    }

    await saveGraph(graphId, graph, userId);
    await addOperation(graphId, operation);

    return graph;
  }

  /**
   * Apply operation to graph (serialized per graph via queue)
   * The operation is chained onto the graph's promise queue, so it CANNOT
   * start until the previous operation for the same graph has finished.
   */
  return function applyOperation(graphId, operation, userId = DEFAULT_USER_ID) {
    const lockKey = `${userId}:${graphId}`;
    const seq = ++operationSeq;

    // Get the current tail of the queue (or a resolved promise if empty)
    const prev = graphQueues.get(lockKey) || Promise.resolve();

    // Chain our operation ONTO the queue — it runs inside .then(),
    // so it physically cannot execute until prev resolves
    const task = prev.then(async () => {
      logger.info(`[QUEUE #${seq}] START ${operation.type} for ${lockKey}`);
      try {
        const result = await executeOperation(graphId, operation, userId, seq);
        logger.info(`[QUEUE #${seq}] DONE ${operation.type} for ${lockKey}`);
        return result;
      } catch (error) {
        logger.error(`[QUEUE #${seq}] ERROR ${operation.type}: ${error.message}`);
        return null;
      }
    });

    // Store the task as the new tail. Use .catch() so errors don't break the chain.
    graphQueues.set(lockKey, task.catch(() => {}));

    // Return the task so the caller gets the operation result
    return task;
  };
}

export default createOperationHandler;
