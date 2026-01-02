/**
 * Operation Handler - Refactored to use modular operations
 * Original: 306 lines → Now: ~60 lines
 * Individual operations are in ./operations/ directory
 * 
 * Performance: Passes NodeIndex for O(1) lookups
 */

import { logger } from '../utils/logger.js';
import { routeOperation } from './operations/index.js';
import { DEFAULT_USER_ID } from '../services/graphService.js';

/**
 * Create operation handler with dependencies
 * @param {Object} deps - Dependencies (getGraph, saveGraph, addOperation, analytics, getNodeIndex)
 */
export function createOperationHandler(deps) {
  const { getGraph, saveGraph, addOperation, analytics, getNodeIndex } = deps;

  /**
   * Apply operation to graph
   * @param {string} graphId - Graph ID
   * @param {Object} operation - Operation object with type and payload
   * @param {string} userId - User ID
   * @returns {Object|null} - Updated graph or null on failure
   */
  return async function applyOperation(graphId, operation, userId = DEFAULT_USER_ID) {
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
  };
}

export default createOperationHandler;
