/**
 * NodeIndex - O(1) lookup for nodes in graph hierarchy
 * Eliminates recursive O(n) search for every operation
 */

import { logger } from '../utils/logger.js';

/**
 * NodeIndex class - maintains a Map for fast node lookup
 * Lifecycle:
 * 1. buildIndex() called when graph is loaded
 * 2. addNode() called on ADD_NODE operation
 * 3. removeNode() called on DELETE_NODE operation
 * 4. getNode() called for O(1) lookup
 */
class NodeIndex {
  constructor() {
    /** @type {Map<string, Object>} nodeId → node reference */
    this.nodeMap = new Map();
    
    /** @type {Map<string, string|null>} nodeId → parentId */
    this.parentMap = new Map();
    
    /** @type {Map<string, string[]>} nodeId → [path, to, node] */
    this.pathCache = new Map();
    
    /** @type {number} Total nodes indexed */
    this.size = 0;
  }

  /**
   * Build index from graph structure
   * Call this when loading a graph
   * @param {Object} graph - Graph object with nodes array
   */
  buildIndex(graph) {
    logger.time('NodeIndex.buildIndex');
    this.clear();
    
    if (graph && graph.nodes) {
      this._indexNodes(graph.nodes, null, []);
    }
    
    logger.timeEnd('NodeIndex.buildIndex');
    logger.debug(`NodeIndex built: ${this.size} nodes indexed`);
  }

  /**
   * Recursively index nodes
   * @private
   */
  _indexNodes(nodes, parentId, currentPath) {
    for (const node of nodes) {
      // Store node reference
      this.nodeMap.set(node.id, node);
      
      // Store parent relationship
      this.parentMap.set(node.id, parentId);
      
      // Store path for analytics
      const nodePath = [...currentPath, node.title || node.id];
      this.pathCache.set(node.id, nodePath);
      
      this.size++;
      
      // Recursively index children
      if (node.children && node.children.length > 0) {
        this._indexNodes(node.children, node.id, nodePath);
      }
    }
  }

  /**
   * Get node by ID - O(1)
   * @param {string} id - Node ID
   * @returns {Object|null} - Node reference or null
   */
  getNode(id) {
    return this.nodeMap.get(id) || null;
  }

  /**
   * Get parent node - O(1)
   * @param {string} id - Child node ID
   * @returns {Object|null} - Parent node or null if root
   */
  getParent(id) {
    const parentId = this.parentMap.get(id);
    if (!parentId) return null;
    return this.nodeMap.get(parentId) || null;
  }

  /**
   * Get parent ID - O(1)
   * @param {string} id - Child node ID
   * @returns {string|null} - Parent ID or null
   */
  getParentId(id) {
    return this.parentMap.get(id) || null;
  }

  /**
   * Get path to node - O(1)
   * @param {string} id - Node ID
   * @returns {string[]} - Array of titles from root to node
   */
  getPath(id) {
    return this.pathCache.get(id) || [];
  }

  /**
   * Check if node exists - O(1)
   * @param {string} id - Node ID
   * @returns {boolean}
   */
  hasNode(id) {
    return this.nodeMap.has(id);
  }

  /**
   * Add a new node to the index
   * Call this after ADD_NODE operation
   * @param {Object} node - New node
   * @param {string|null} parentId - Parent node ID or null for root
   */
  addNode(node, parentId = null) {
    // Get parent path
    const parentPath = parentId ? this.getPath(parentId) : [];
    const nodePath = [...parentPath, node.title || node.id];
    
    // Index the node
    this.nodeMap.set(node.id, node);
    this.parentMap.set(node.id, parentId);
    this.pathCache.set(node.id, nodePath);
    this.size++;
    
    logger.debug(`NodeIndex: Added node ${node.id} (parent: ${parentId})`);
    
    // Index any children the node might have
    if (node.children && node.children.length > 0) {
      this._indexNodes(node.children, node.id, nodePath);
    }
  }

  /**
   * Remove node and its children from index
   * Call this after DELETE_NODE operation
   * @param {string} id - Node ID to remove
   */
  removeNode(id) {
    const node = this.nodeMap.get(id);
    if (!node) {
      logger.warn(`NodeIndex: Node ${id} not found for removal`);
      return;
    }
    
    // Recursively remove children first
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        this.removeNode(child.id);
      }
    }
    
    // Remove from all maps
    this.nodeMap.delete(id);
    this.parentMap.delete(id);
    this.pathCache.delete(id);
    this.size--;
    
    logger.debug(`NodeIndex: Removed node ${id}`);
  }

  /**
   * Update node's path in cache (call after title change)
   * @param {string} id - Node ID
   */
  updatePath(id) {
    const parentId = this.parentMap.get(id);
    const node = this.nodeMap.get(id);
    if (!node) return;
    
    const parentPath = parentId ? this.getPath(parentId) : [];
    const newPath = [...parentPath, node.title || node.id];
    this.pathCache.set(id, newPath);
    
    // Update children paths recursively
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        this.updatePath(child.id);
      }
    }
  }

  /**
   * Get all ancestor node IDs (for affected nodes calculation)
   * @param {string} id - Starting node ID
   * @returns {string[]} - Array of ancestor IDs from immediate parent to root
   */
  getAncestorIds(id) {
    const ancestors = [];
    let currentId = this.parentMap.get(id);
    
    while (currentId) {
      ancestors.push(currentId);
      currentId = this.parentMap.get(currentId);
    }
    
    return ancestors;
  }

  /**
   * Get all descendants (children, grandchildren, etc.)
   * @param {string} id - Parent node ID
   * @returns {Object[]} - Array of all descendant nodes
   */
  getDescendants(id) {
    const node = this.nodeMap.get(id);
    if (!node || !node.children) return [];
    
    const descendants = [];
    const collectDescendants = (nodes) => {
      for (const n of nodes) {
        descendants.push(n);
        if (n.children && n.children.length > 0) {
          collectDescendants(n.children);
        }
      }
    };
    
    collectDescendants(node.children);
    return descendants;
  }

  /**
   * Clear the entire index
   */
  clear() {
    this.nodeMap.clear();
    this.parentMap.clear();
    this.pathCache.clear();
    this.size = 0;
  }

  /**
   * Get statistics about the index
   * @returns {Object} - Index stats
   */
  getStats() {
    return {
      totalNodes: this.size,
      mapSize: this.nodeMap.size,
      parentMapSize: this.parentMap.size,
      pathCacheSize: this.pathCache.size
    };
  }
}

// Singleton instance - one index per graph
// For multi-graph support, use a Map<graphId, NodeIndex>
const graphIndexes = new Map();

/**
 * Get or create NodeIndex for a specific graph
 * @param {string} graphId - Graph identifier
 * @returns {NodeIndex}
 */
export function getNodeIndex(graphId) {
  if (!graphIndexes.has(graphId)) {
    graphIndexes.set(graphId, new NodeIndex());
  }
  return graphIndexes.get(graphId);
}

/**
 * Clear index for a specific graph
 * @param {string} graphId - Graph identifier
 */
export function clearNodeIndex(graphId) {
  if (graphIndexes.has(graphId)) {
    graphIndexes.get(graphId).clear();
    graphIndexes.delete(graphId);
  }
}

/**
 * Clear all indexes
 */
export function clearAllIndexes() {
  graphIndexes.forEach(index => index.clear());
  graphIndexes.clear();
}

export { NodeIndex };
export default { NodeIndex, getNodeIndex, clearNodeIndex, clearAllIndexes };
