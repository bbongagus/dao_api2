/**
 * UPDATE_NODE Operation Handler
 * Extracted from operationHandler.js
 * 
 * Performance: Uses NodeIndex for O(1) lookup when available
 */

import { logger } from '../../utils/logger.js';
import { 
  DEFAULT_USER_ID, 
  calculateNodeProgress, 
  findNodeCategory, 
  getNodePath,
  findAffectedNodes 
} from '../../services/graphService.js';

/**
 * Handle UPDATE_NODE operation
 * @param {Object} graph - The graph object
 * @param {Object} payload - Operation payload
 * @param {string} graphId - Graph ID for analytics
 * @param {Object} analytics - Analytics service
 * @param {Object} nodeIndex - NodeIndex for O(1) lookup (optional)
 * @returns {boolean} - Success status
 */
export function handleUpdateNode(graph, payload, graphId, analytics, nodeIndex = null) {
  // Handle both payload.id and payload.nodeId for backward compatibility
  const nodeIdToUpdate = payload.id || payload.nodeId;
  logger.debug(`UPDATE_NODE for ${nodeIdToUpdate}:`, payload.updates);
  
  if (!nodeIdToUpdate) {
    logger.error('UPDATE_NODE: No node ID provided');
    return false;
  }
  
  // Try O(1) lookup with NodeIndex first
  let node = null;
  
  if (nodeIndex && nodeIndex.hasNode(nodeIdToUpdate)) {
    // O(1) lookup!
    node = nodeIndex.getNode(nodeIdToUpdate);
    logger.debug(`Found node via NodeIndex (O(1))`);
  } else {
    // Fallback to O(n) recursive search
    node = findNodeRecursive(graph.nodes, nodeIdToUpdate);
    logger.debug(`Found node via recursive search (O(n))`);
  }
  
  if (!node) {
    logger.warn(`Node ${nodeIdToUpdate} not found for update`);
    return false;
  }
  
  // Apply updates to node
  applyNodeUpdates(node, payload.updates);
  
  // Track analytics for progress updates ONLY
  if (analytics && (payload.updates.isDone !== undefined || payload.updates.currentCompletions !== undefined)) {
    trackProgressAnalytics(graph, node, nodeIdToUpdate, graphId, analytics, nodeIndex);
  }
  
  // Update NodeIndex if title changed (affects path cache)
  if (nodeIndex && payload.updates.title !== undefined) {
    nodeIndex.updatePath(nodeIdToUpdate);
  }
  
  logger.success(`Node ${nodeIdToUpdate} updated successfully`);
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

/**
 * Apply updates to a node
 */
function applyNodeUpdates(node, updates) {
  logger.debug(`Applying updates to node, current state: isDone=${node.isDone}, completions=${node.currentCompletions}/${node.requiredCompletions}`);
  
  // Update node properties
  Object.assign(node, updates);
  
  // Special handling for children array
  if (updates.children !== undefined) {
    node.children = updates.children;
    logger.debug(`Updated children array, now has ${node.children.length} children`);
    
    // Check if children have linkedNodeIds
    const childrenWithLinks = node.children.filter(c => c.linkedNodeIds && Object.keys(c.linkedNodeIds).length > 0);
    if (childrenWithLinks.length > 0) {
      logger.debug(`${childrenWithLinks.length} children have linkedNodeIds`);
    }
  }
  
  // Handle linkedNodeIds updates
  if (updates.linkedNodeIds !== undefined) {
    node.linkedNodeIds = updates.linkedNodeIds;
    const linkedIdsCount = Object.keys(node.linkedNodeIds).length;
    logger.debug(`Updated linkedNodeIds: ${linkedIdsCount} connection types`);
  }
  
  // Log specific field updates
  if (updates.isDone !== undefined) {
    logger.debug(`Updated isDone to: ${node.isDone}`);
  }
  if (updates.currentCompletions !== undefined) {
    logger.debug(`Updated currentCompletions to: ${node.currentCompletions}`);
  }
  if (updates.requiredCompletions !== undefined) {
    logger.debug(`Updated requiredCompletions to: ${node.requiredCompletions}`);
  }
  if (updates.nodeSubtype !== undefined) {
    logger.debug(`Updated nodeSubtype to: ${node.nodeSubtype}`);
  }
  if (updates.calculatedProgress !== undefined) {
    logger.debug(`Updated calculatedProgress to: ${node.calculatedProgress}`);
  }
  
  logger.debug(`After update: isDone=${node.isDone}, completions=${node.currentCompletions}/${node.requiredCompletions}, progress=${node.calculatedProgress ? Math.round(node.calculatedProgress * 100) : 0}%`);
}

/**
 * Track progress analytics for affected nodes
 */
function trackProgressAnalytics(graph, node, nodeIdToUpdate, graphId, analytics, nodeIndex) {
  // Track all affected nodes (current + parents that calculate from it)
  const affectedNodes = findAffectedNodes(graph.nodes, nodeIdToUpdate);
  
  for (const affectedNode of affectedNodes) {
    // Use NodeIndex for faster path lookup if available
    let nodePath;
    if (nodeIndex) {
      nodePath = nodeIndex.getPath(affectedNode.id);
    } else {
      nodePath = getNodePath(graph.nodes, affectedNode.id);
    }
    
    const category = findNodeCategory(graph.nodes, affectedNode.id);
    
    // Calculate progress for each affected node
    const currentProgress = calculateNodeProgress(affectedNode);
    
    // Save calculatedProgress for affected nodes (especially important for fundamental nodes)
    if (affectedNode.nodeType === 'fundamental') {
      affectedNode.calculatedProgress = currentProgress / 100; // Store as 0-1 value
      logger.debug(`Saved calculatedProgress=${affectedNode.calculatedProgress} for fundamental node ${affectedNode.id}`);
    }
    
    // Track progress update in simplified analytics
    analytics.trackProgressUpdate(DEFAULT_USER_ID, graphId, affectedNode.id, {
      nodeTitle: affectedNode.title || affectedNode.name || 'Unknown',
      nodePath: nodePath,
      nodeType: affectedNode.nodeType,
      nodeSubtype: affectedNode.nodeSubtype,
      categoryId: category ? category.id : null,
      categoryName: category ? (category.title || category.name) : null,
      previousProgress: affectedNode.previousProgress || 0,
      currentProgress: currentProgress,
      isDone: affectedNode.isDone,
      previousIsDone: affectedNode.previousIsDone,
      currentCompletions: affectedNode.currentCompletions || 0,
      requiredCompletions: affectedNode.requiredCompletions || 1
    });
    
    logger.analytics(`Tracked progress ${currentProgress}% for affected node ${affectedNode.id}`);
  }
}

export default handleUpdateNode;
