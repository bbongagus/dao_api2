/**
 * DELETE_NODE Operation Handler
 * Extracted from operationHandler.js
 * 
 * Performance: Uses NodeIndex for O(1) lookup and updates index on delete
 */

import { logger } from '../../utils/logger.js';

/**
 * Handle DELETE_NODE operation
 * @param {Object} graph - The graph object
 * @param {Object} payload - Operation payload
 * @param {Object} nodeIndex - NodeIndex for O(1) lookup (optional)
 * @returns {boolean} - Success status
 */
export function handleDeleteNode(graph, payload, nodeIndex = null) {
  const nodeId = payload.nodeId;
  logger.debug(`DELETE_NODE: Removing node ${nodeId}`);
  
  // If using NodeIndex, get parent info before deleting
  let parentId = null;
  if (nodeIndex && nodeIndex.hasNode(nodeId)) {
    parentId = nodeIndex.getParentId(nodeId);
    logger.debug(`Node ${nodeId} parent: ${parentId || 'root'} (from NodeIndex)`);
  }
  
  // Everything inside goes with the node, so its edges must go too. Until
  // 2026-09-23 only the node's own were removed, and every arrow between its
  // descendants stayed in the graph pointing at nothing.
  const gone = subtreeIds((nodeIndex && nodeIndex.getNode(nodeId)) || findNode(graph.nodes, nodeId));

  // Remove node from graph hierarchy
  const removed = removeNodeFromHierarchy(graph, nodeId, parentId, nodeIndex);
  
  if (removed) {
    // Remove edges connected to this node or anything inside it
    const edgesBefore = (graph.edges || []).length;
    graph.edges = (graph.edges || []).filter(e =>
      !gone.has(e.source) && !gone.has(e.target)
    );
    forgetLinks(graph.nodes, gone);
    const edgesRemoved = edgesBefore - graph.edges.length;
    
    if (edgesRemoved > 0) {
      logger.debug(`Removed ${edgesRemoved} connected edges`);
    }
    
    // Update NodeIndex
    if (nodeIndex) {
      nodeIndex.removeNode(nodeId);
      logger.debug(`Updated NodeIndex, new size: ${nodeIndex.size}`);
    }
    
    logger.success(`Node ${nodeId} deleted successfully`);
  } else {
    logger.warn(`Node ${nodeId} not found for deletion`);
  }
  
  return removed;
}

/** The node's id and the ids of everything nested in it. */
function subtreeIds(node, ids = new Set()) {
  if (!node) return ids;
  ids.add(node.id);
  for (const child of node.children || []) subtreeIds(child, ids);
  return ids;
}

function findNode(nodes, nodeId) {
  for (const node of nodes || []) {
    if (node.id === nodeId) return node;
    const inside = findNode(node.children, nodeId);
    if (inside) return inside;
  }
  return null;
}

/** The editor's copy of the links (CLAUDE.md, "A link is stored twice") must not name deleted nodes either. */
function forgetLinks(nodes, gone) {
  for (const node of nodes || []) {
    const links = node.linkedNodeIds;
    if (links) {
      for (const side of ['upstream', 'downstream']) {
        if (Array.isArray(links[side])) links[side] = links[side].filter((id) => !gone.has(id));
      }
    }
    forgetLinks(node.children, gone);
  }
}

/**
 * Remove node from hierarchy
 * Uses parentId hint if available for faster removal
 */
function removeNodeFromHierarchy(graph, nodeId, parentId, nodeIndex) {
  // If we know the parent, go directly to it (O(1) with NodeIndex)
  if (parentId && nodeIndex) {
    const parent = nodeIndex.getNode(parentId);
    if (parent && parent.children) {
      const index = parent.children.findIndex(c => c.id === nodeId);
      if (index !== -1) {
        parent.children.splice(index, 1);
        logger.debug(`Removed from parent via direct access (O(1))`);
        return true;
      }
    }
  }
  
  // Check root nodes first
  const rootIndex = graph.nodes.findIndex(n => n.id === nodeId);
  if (rootIndex !== -1) {
    graph.nodes.splice(rootIndex, 1);
    logger.debug(`Removed from root nodes`);
    return true;
  }
  
  // Fallback: Recursive search (O(n))
  return removeNodeRecursive(graph.nodes, nodeId);
}

/**
 * Fallback recursive removal (O(n))
 */
function removeNodeRecursive(nodes, nodeId) {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === nodeId) {
      nodes.splice(i, 1);
      return true;
    }
    if (nodes[i].children && nodes[i].children.length > 0) {
      if (removeNodeRecursive(nodes[i].children, nodeId)) {
        return true;
      }
    }
  }
  return false;
}

export default handleDeleteNode;
