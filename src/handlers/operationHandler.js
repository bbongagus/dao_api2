/**
 * Operation Handler - Refactored to use modular operations
 * Individual operations are in ./operations/ directory
 *
 * CRITICAL: Uses per-graph mutex to prevent concurrent read-modify-write races.
 * Without this, rapid operations (e.g. creating 3 nodes quickly) would each read
 * the same graph version from Redis, and only the last save would survive.
 *
 * Performance: Passes NodeIndex for O(1) lookups
 */

import { logger } from '../utils/logger.js';
import { routeOperation } from './operations/index.js';
import { DEFAULT_USER_ID } from '../services/graphService.js';

// Per-graph operation queue: ensures operations for the same graph run sequentially.
// Key: "userId:graphId", Value: Promise chain
const graphLocks = new Map();

/**
 * Acquire a per-graph lock. Returns a release function.
 * Operations on the same graph wait for the previous one to finish.
 */
function acquireGraphLock(graphId, userId) {
  const lockKey = `${userId}:${graphId}`;
  const previous = graphLocks.get(lockKey) || Promise.resolve();

  let release;
  const next = new Promise(resolve => { release = resolve; });
  graphLocks.set(lockKey, next);

  return previous.then(() => release);
}

/**
 * Create operation handler with dependencies
 * @param {Object} deps - Dependencies (getGraph, saveGraph, addOperation, analytics, getNodeIndex)
 */
export function createOperationHandler(deps) {
  const { getGraph, saveGraph, addOperation, analytics, getNodeIndex } = deps;

  /**
   * Apply operation to graph (serialized per graph via mutex)
   * @param {string} graphId - Graph ID
   * @param {Object} operation - Operation object with type and payload
   * @param {string} userId - User ID
   * @returns {Object|null} - Updated graph or null on failure
   */
  return async function applyOperation(graphId, operation, userId = DEFAULT_USER_ID) {
    // Acquire lock — waits for previous operation on this graph to finish
    const release = await acquireGraphLock(graphId, userId);

    try {
      logger.time(`operation:${operation.type}`);

      const graph = await getGraph(graphId, userId);
      if (!graph) {
        logger.error(`Graph ${graphId} not found for user ${userId}`);
        return null;
      }

      const { type, payload } = operation;

      // Get NodeIndex for O(1) lookups
      const nodeIndex = getNodeIndex ? getNodeIndex(graphId, userId) : null;

      // Route to appropriate handler - pass userId for daily completions tracking
      const success = routeOperation(type, graph, payload, graphId, analytics, nodeIndex, userId);

      if (!success) {
        logger.error(`Operation ${type} failed`);
        logger.timeEnd(`operation:${operation.type}`);
        return null;
      }

      // Save graph and log operation
      await saveGraph(graphId, graph, userId);
      await addOperation(graphId, operation);

      logger.timeEnd(`operation:${operation.type}`);

      return graph;
    } finally {
      // Always release the lock, even on error
      release();
    }
  };
}

export default createOperationHandler;
