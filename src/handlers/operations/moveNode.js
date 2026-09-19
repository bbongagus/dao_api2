/**
 * MOVE_NODE — put an existing node, with its whole subtree, under another
 * parent (or at the top level when parentId is null).
 *
 * Undo needs it: taking back a pack moves nodes out of the group again, and a
 * move sent as DELETE_NODE + ADD_NODE would break in the sending tab, whose
 * own DELETE_NODE echo removes the node it has just put back. A move is
 * idempotent, so its echo is harmless.
 *
 * It only detaches and attaches: edges stay, and the kinds of the old and new
 * parents are whatever the client sends for them.
 */

import { logger } from '../../utils/logger.js';

/** The array that holds the node, and the node, anywhere in the tree. */
function locate(nodes, nodeId) {
  for (const node of nodes) {
    if (node.id === nodeId) return { container: nodes, node };
    const found = locate(node.children || [], nodeId);
    if (found) return found;
  }
  return null;
}

function contains(node, id) {
  return (node.children || []).some((child) => child.id === id || contains(child, id));
}

/**
 * @param {Object} graph - The graph object
 * @param {{ nodeId: string, parentId: string|null }} payload
 * @returns {boolean} - false when the node or the parent is unknown, or the
 *   parent is the node itself or inside it
 */
export function handleMoveNode(graph, payload) {
  const { nodeId, parentId = null } = payload;

  const from = locate(graph.nodes, nodeId);
  if (!from) {
    logger.warn(`MOVE_NODE: node ${nodeId} not found`);
    return false;
  }

  let target = graph.nodes;
  if (parentId) {
    const parent = locate(graph.nodes, parentId)?.node;
    if (!parent) {
      logger.warn(`MOVE_NODE: parent ${parentId} not found`);
      return false;
    }
    if (parent.id === nodeId || contains(from.node, parentId)) {
      logger.warn(`MOVE_NODE: ${nodeId} cannot move inside itself`);
      return false;
    }
    if (!parent.children) parent.children = [];
    target = parent.children;
  }

  if (target === from.container) return true;

  from.container.splice(from.container.indexOf(from.node), 1);
  target.push(from.node);
  return true;
}

export default handleMoveNode;
