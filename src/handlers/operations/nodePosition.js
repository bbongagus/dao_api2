/**
 * UPDATE_NODE_POSITION Operation Handler
 * Extracted from operationHandler.js
 *
 * Performance: Uses NodeIndex for O(1) lookup
 * NOTE: No logging here to avoid performance issues during drag (60+ FPS)
 */

import { logger } from '../../utils/logger.js';

/**
 * Handle UPDATE_NODE_POSITION operation
 * @param {Object} graph - The graph object
 * @param {Object} payload - Operation payload
 * @param {Object} nodeIndex - NodeIndex for O(1) lookup (optional)
 * @returns {boolean} - Success status
 */
export function handleUpdateNodePosition(graph, payload, nodeIndex = null) {
  const { nodeId, position } = payload;
  
  let node = null;
  
  // Try O(1) lookup with NodeIndex first (no logging - performance critical)
  if (nodeIndex && nodeIndex.hasNode(nodeId)) {
    node = nodeIndex.getNode(nodeId);
  } else {
    // Fallback to O(n) recursive search
    node = findNodeRecursive(graph.nodes, nodeId);
  }
  
  if (node) {
    node.position = position;
    return true;
  }
  
  // Only log if node not found (error case)
  logger.warn(`Node ${nodeId} not found for position update`);
  return false;
}

/**
 * Fallback recursive search (O(n))
 */
function findNodeRecursive(nodes, nodeId) {
  for (let node of nodes) {
    if (node.id === nodeId) {
      return node;
    }
    if (node.children && node.children.length > 0) {
      const found = findNodeRecursive(node.children, nodeId);
      if (found) return found;
    }
  }
  return null;
}

export default handleUpdateNodePosition;
