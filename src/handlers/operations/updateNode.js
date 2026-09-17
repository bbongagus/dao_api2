/**
 * UPDATE_NODE Operation Handler
 * Extracted from operationHandler.js
 *
 * Performance: Uses NodeIndex for O(1) lookup when available
 * Now with Daily Completions tracking for eye-toggle feature
 */

import { logger } from '../../utils/logger.js';
import dailyCompletions from '../../services/dailyCompletions.js';

/**
 * Handle UPDATE_NODE operation
 * @param {Object} graph - The graph object
 * @param {Object} payload - Operation payload
 * @param {string} graphId - Graph ID, for daily completions
 * @param {Object} nodeIndex - NodeIndex for O(1) lookup (optional)
 * @param {string} userId - Whose graph this is, for daily completions
 * @returns {boolean} - Success status
 */
export function handleUpdateNode(graph, payload, graphId, nodeIndex = null, userId) {
  if (!userId) throw new Error('UPDATE_NODE without a userId');

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

  // Save previous isDone state for daily completions tracking
  const previousIsDone = node.isDone;

  // Apply updates to node
  applyNodeUpdates(node, payload.updates);

  // Track daily completions (isDone changed) - pass userId for per-user tracking
  if (payload.updates.isDone !== undefined && payload.updates.isDone !== previousIsDone) {
    trackDailyCompletion(nodeIdToUpdate, graphId, previousIsDone, payload.updates.isDone, userId);
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
 * Track daily completion changes
 * Adds/removes node from today's completions list
 * @param {string} nodeId - Node ID
 * @param {string} graphId - Graph ID
 * @param {boolean} previousIsDone - Previous isDone state
 * @param {boolean} newIsDone - New isDone state
 * @param {string} userId - User ID for per-user tracking
 */
async function trackDailyCompletion(nodeId, graphId, previousIsDone, newIsDone, userId) {
  logger.info(`📅 trackDailyCompletion: nodeId=${nodeId}, graphId=${graphId}, userId=${userId}, prev=${previousIsDone}, new=${newIsDone}`);

  try {
    // Node marked as done (false → true)
    if (newIsDone && !previousIsDone) {
      await dailyCompletions.addCompletion(userId, graphId, nodeId);
      logger.success(`📅 Added ${nodeId} to daily completions for user ${userId}`);
    }

    // Node unmarked (true → false)
    if (!newIsDone && previousIsDone) {
      await dailyCompletions.removeCompletion(userId, graphId, nodeId);
      logger.success(`📅 Removed ${nodeId} from daily completions for user ${userId}`);
    }
  } catch (error) {
    // Don't fail the update if daily tracking fails
    logger.error('📅 Failed to track daily completion:', error);
  }
}

export default handleUpdateNode;
