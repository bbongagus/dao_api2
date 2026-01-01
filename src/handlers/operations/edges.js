/**
 * Edge Operations Handler (ADD_EDGE, DELETE_EDGE)
 * Extracted from operationHandler.js
 */

import { logger } from '../../utils/logger.js';

/**
 * Handle ADD_EDGE operation
 * @param {Object} graph - The graph object
 * @param {Object} payload - Operation payload
 * @returns {boolean} - Success status
 */
export function handleAddEdge(graph, payload) {
  const newEdge = {
    id: payload.id,
    source: payload.source,
    target: payload.target,
    type: payload.type || 'floating'
  };
  
  graph.edges.push(newEdge);
  logger.debug(`Added edge ${newEdge.id}: ${newEdge.source} → ${newEdge.target}`);
  
  return true;
}

/**
 * Handle DELETE_EDGE operation
 * @param {Object} graph - The graph object
 * @param {Object} payload - Operation payload
 * @returns {boolean} - Success status
 */
export function handleDeleteEdge(graph, payload) {
  const edgeId = payload.edgeId;
  const edgesBefore = graph.edges.length;
  
  graph.edges = graph.edges.filter(e => e.id !== edgeId);
  
  const removed = graph.edges.length < edgesBefore;
  
  if (removed) {
    logger.debug(`Deleted edge ${edgeId}`);
  } else {
    logger.warn(`Edge ${edgeId} not found for deletion`);
  }
  
  return removed;
}

export default { handleAddEdge, handleDeleteEdge };
