/**
 * ADD_NODE Operation Handler
 * Extracted from operationHandler.js
 * 
 * Performance: Uses NodeIndex for O(1) parent lookup and updates index
 */

import { logger } from '../../utils/logger.js';

/**
 * Handle ADD_NODE operation
 * @param {Object} graph - The graph object
 * @param {Object} payload - Operation payload
 * @param {Object} nodeIndex - NodeIndex for O(1) lookup (optional)
 * @returns {boolean} - Success status
 */
export function handleAddNode(graph, payload, nodeIndex = null) {
  const newNode = {
    id: payload.id,
    title: payload.title || 'New Node',
    nodeType: payload.nodeType || 'dao',
    nodeSubtype: payload.nodeSubtype || 'simple',
    position: payload.position || { x: 0, y: 0 },
    isDone: payload.isDone || false,
    currentCompletions: payload.currentCompletions || 0,
    requiredCompletions: payload.requiredCompletions || 1,
    calculatedProgress: payload.calculatedProgress || 0,
    linkedNodeIds: payload.linkedNodeIds || {},
    children: payload.children || []
  };
  
  // Log linkedNodeIds status
  const linkedIdsCount = Object.keys(newNode.linkedNodeIds).length;
  logger.debug(`Adding node: id=${newNode.id}, title="${newNode.title}", isDone=${newNode.isDone}`);
  
  if (linkedIdsCount > 0) {
    logger.debug(`Node has ${linkedIdsCount} linkedNodeIds connection types`);
  }
  
  let parentNode = null;
  
  // If there's a parentId, find parent and add as child
  if (payload.parentId) {
    logger.debug(`Looking for parent ${payload.parentId}`);
    
    // Try O(1) lookup with NodeIndex first
    if (nodeIndex && nodeIndex.hasNode(payload.parentId)) {
      parentNode = nodeIndex.getNode(payload.parentId);
      logger.debug(`Found parent via NodeIndex (O(1))`);
    } else {
      // Fallback to O(n) recursive search
      parentNode = findNodeRecursive(graph.nodes, payload.parentId);
      logger.debug(`Found parent via recursive search (O(n))`);
    }
    
    if (parentNode) {
      if (!parentNode.children) parentNode.children = [];
      parentNode.children.push(newNode);
      logger.debug(`Added child to parent ${payload.parentId}`);
      
      // Update parent's subtype if needed
      if (parentNode.nodeType === 'dao' && parentNode.nodeSubtype === 'simple') {
        parentNode.nodeSubtype = 'withChildren';
        logger.debug(`Updated parent subtype to 'withChildren'`);
      } else if (parentNode.nodeType === 'fundamental' && parentNode.nodeSubtype === 'simple') {
        parentNode.nodeSubtype = 'category';
        logger.debug(`Updated parent subtype to 'category'`);
      }
    } else {
      logger.warn(`Parent ${payload.parentId} not found! Adding as root node`);
      graph.nodes.push(newNode);
    }
  } else {
    logger.debug(`Adding ${payload.id} as root node (no parentId)`);
    graph.nodes.push(newNode);
  }
  
  // Update NodeIndex
  if (nodeIndex) {
    nodeIndex.addNode(newNode, payload.parentId || null);
    logger.debug(`Updated NodeIndex, new size: ${nodeIndex.size}`);
  }
  
  logger.debug(`After ADD_NODE - Graph has ${graph.nodes.length} root nodes`);
  
  return true;
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

export default handleAddNode;
