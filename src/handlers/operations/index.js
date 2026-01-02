/**
 * Operations Index - Router for all graph operations
 * Replaces the large switch statement in operationHandler.js
 * 
 * Now passes NodeIndex for O(1) lookups
 */

import { logger } from '../../utils/logger.js';
import { handleAddNode } from './addNode.js';
import { handleUpdateNode } from './updateNode.js';
import { handleDeleteNode } from './deleteNode.js';
import { handleUpdateNodePosition } from './nodePosition.js';
import { handleAddEdge, handleDeleteEdge } from './edges.js';
import { handleUpdateViewport } from './viewport.js';

/**
 * Operation handlers map
 * Maps operation type to handler function
 * Signature: (graph, payload, graphId, analytics, nodeIndex) => boolean
 */
const operationHandlers = {
  ADD_NODE: (graph, payload, graphId, analytics, nodeIndex, userId) =>
    handleAddNode(graph, payload, nodeIndex),
  
  UPDATE_NODE: (graph, payload, graphId, analytics, nodeIndex, userId) =>
    handleUpdateNode(graph, payload, graphId, analytics, nodeIndex, userId),
  
  UPDATE_NODE_POSITION: (graph, payload, graphId, analytics, nodeIndex, userId) =>
    handleUpdateNodePosition(graph, payload, nodeIndex),
  
  DELETE_NODE: (graph, payload, graphId, analytics, nodeIndex, userId) =>
    handleDeleteNode(graph, payload, nodeIndex),
  
  ADD_EDGE: (graph, payload) =>
    handleAddEdge(graph, payload),
  
  DELETE_EDGE: (graph, payload) =>
    handleDeleteEdge(graph, payload),
  
  UPDATE_VIEWPORT: (graph, payload) =>
    handleUpdateViewport(graph, payload),
};

/**
 * Route operation to appropriate handler
 * @param {string} type - Operation type
 * @param {Object} graph - The graph object
 * @param {Object} payload - Operation payload
 * @param {string} graphId - Graph ID (for analytics)
 * @param {Object} analytics - Analytics service
 * @param {Object} nodeIndex - NodeIndex for O(1) lookups
 * @param {string} userId - User ID for daily completions tracking
 * @returns {boolean} - Success status
 */
export function routeOperation(type, graph, payload, graphId, analytics, nodeIndex, userId) {
  const handler = operationHandlers[type];
  
  if (!handler) {
    logger.warn(`Unknown operation type: ${type}`);
    return false;
  }
  
  logger.operation(type, { nodeId: payload.id || payload.nodeId || payload.edgeId });
  
  return handler(graph, payload, graphId, analytics, nodeIndex, userId);
}

// Export individual handlers for direct access if needed
export {
  handleAddNode,
  handleUpdateNode,
  handleDeleteNode,
  handleUpdateNodePosition,
  handleAddEdge,
  handleDeleteEdge,
  handleUpdateViewport,
};

export default routeOperation;
