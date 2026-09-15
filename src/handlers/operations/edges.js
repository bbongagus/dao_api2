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
  // Check if edge already exists (prevent duplicates)
  const existingEdge = graph.edges.find(e => e.id === payload.id);
  if (existingEdge) {
    logger.warn(`Edge ${payload.id} already exists, skipping duplicate add`);
    return true; // Return true as this is not an error
  }

  // A pair is connected or it is not. A second edge between the same two
  // nodes draws on top of the first, so nobody sees it — but it is stored.
  const samePair = graph.edges.find(e => e.source === payload.source && e.target === payload.target);
  if (samePair) {
    logger.warn(`Edge ${payload.source} → ${payload.target} already exists as ${samePair.id}, skipping ${payload.id}`);
    return true;
  }

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
