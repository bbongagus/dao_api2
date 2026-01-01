/**
 * Graph Service - Extracted from simple-server.js
 * All graph-related business logic
 */

// Default user ID for testing (matches frontend)
export const DEFAULT_USER_ID = '1';

/**
 * Check if progress should be reset (daily reset logic)
 * Copied from simple-server.js lines 69-92
 */
export function shouldResetProgress(graph) {
  const settings = graph.settings || {};
  if (!settings.resetProgressEnabled) return false;
  
  const lastReset = settings.lastProgressReset;
  const now = new Date();
  
  if (!lastReset) return true;
  
  const lastResetDate = new Date(lastReset);
  const frequency = settings.resetFrequency || 'daily';
  
  if (frequency === 'daily') {
    return now.toDateString() !== lastResetDate.toDateString();
  } else if (frequency === 'weekly') {
    const weeksDiff = Math.floor((now - lastResetDate) / (7 * 24 * 60 * 60 * 1000));
    return weeksDiff >= 1;
  } else if (frequency === 'monthly') {
    return now.getMonth() !== lastResetDate.getMonth() ||
           now.getFullYear() !== lastResetDate.getFullYear();
  }
  
  return false;
}

/**
 * Reset progress for all nodes
 * Copied from simple-server.js lines 97-115
 */
export function resetAllProgress(graph) {
  const resetNode = (node) => {
    if (node.nodeType === 'dao') {
      node.isDone = false;
      node.currentCompletions = 0;
    }
    if (node.children) {
      node.children.forEach(resetNode);
    }
  };
  
  graph.nodes.forEach(resetNode);
  
  // Update settings
  if (!graph.settings) graph.settings = {};
  graph.settings.lastProgressReset = new Date().toISOString();
  
  console.log('✅ Progress reset for all nodes');
}

/**
 * Helper: Find category parent for a node
 * Copied from simple-server.js lines 497-512
 */
export function findNodeCategory(nodes, targetNodeId, parent = null) {
  for (const node of nodes) {
    if (node.id === targetNodeId) {
      // Found target, return parent if it's a category
      if (parent && parent.nodeType === 'fundamental' && parent.nodeSubtype === 'category') {
        return parent;
      }
      return null;
    }
    if (node.children) {
      const found = findNodeCategory(node.children, targetNodeId, node);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Helper: Get node path from root to node
 * Copied from simple-server.js lines 517-529
 */
export function getNodePath(nodes, targetNodeId, currentPath = []) {
  for (const node of nodes) {
    const newPath = [...currentPath, node.id];
    if (node.id === targetNodeId) {
      return newPath;
    }
    if (node.children) {
      const found = getNodePath(node.children, targetNodeId, newPath);
      if (found) return found;
    }
  }
  return [];
}

/**
 * Calculate node progress (handles both DAO and Fundamental nodes)
 * Copied from simple-server.js lines 534-553
 */
export function calculateNodeProgress(node) {
  if (node.nodeType === 'dao') {
    if (node.isDone) return 100;
    if (node.requiredCompletions > 0) {
      return (node.currentCompletions / node.requiredCompletions) * 100;
    }
    return 0;
  } else if (node.nodeType === 'fundamental') {
    // For fundamental nodes, calculate from children
    if (node.nodeSubtype === 'category' && node.children) {
      const childProgress = node.children.map(child => calculateNodeProgress(child));
      if (childProgress.length > 0) {
        return childProgress.reduce((a, b) => a + b, 0) / childProgress.length;
      }
    }
    // Use calculatedProgress if available
    return (node.calculatedProgress || 0) * 100;
  }
  return 0;
}

/**
 * Find all nodes affected by a change (current + parents)
 * Copied from simple-server.js lines 558-596
 */
export function findAffectedNodes(nodes, targetNodeId, affected = []) {
  // First, find the target node
  let targetNode = null;
  const findTarget = (nodes) => {
    for (const node of nodes) {
      if (node.id === targetNodeId) {
        targetNode = node;
        return;
      }
      if (node.children) findTarget(node.children);
    }
  };
  findTarget(nodes);
  
  if (targetNode) {
    affected.push(targetNode);
  }
  
  // Find all parents that might be affected
  const findParents = (nodes, parent = null) => {
    for (const node of nodes) {
      if (node.children) {
        // Check if this node has the target as a child
        if (node.children.some(child => child.id === targetNodeId)) {
          if (!affected.find(n => n.id === node.id)) {
            affected.push(node);
            // Recursively find parents of this parent
            findAffectedNodes(nodes, node.id, affected);
          }
        }
        // Continue searching in children
        findParents(node.children, node);
      }
    }
  };
  findParents(nodes);
  
  return affected;
}
