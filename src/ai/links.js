/**
 * Which nodes lead to which.
 *
 * A link is stored twice over, and the two copies disagree. The server keeps
 * `graph.edges` and never touches `linkedNodeIds`; the editor keeps both but
 * only sends the edge. Reading either copy alone misses links — an agent that
 * read only `linkedNodeIds` saw no links at all, and kept adding them again.
 * So the index reads both and keeps each pair once.
 *
 * An edge runs source → target unless it says otherwise: `upstream` reverses
 * it, the way the editor stores it, and `neutral` is drawn but links nothing.
 * An edge with no direction is `downstream`, the editor's default.
 */

export function buildLinkIndex(nodes, edges = []) {
  const downstream = new Map(); // id → ids to its right
  const upstream = new Map(); // id → ids to its left

  const add = (from, to) => {
    if (!from || !to || from === to) return;
    if (!downstream.has(from)) downstream.set(from, new Set());
    if (!upstream.has(to)) upstream.set(to, new Set());
    downstream.get(from).add(to);
    upstream.get(to).add(from);
  };

  for (const edge of edges || []) {
    if (!edge || edge.direction === 'neutral') continue;
    if (edge.direction === 'upstream') add(edge.target, edge.source);
    else add(edge.source, edge.target);
  }

  const walk = (list) => {
    for (const node of list || []) {
      for (const id of node.linkedNodeIds?.downstream || []) add(node.id, id);
      for (const id of node.linkedNodeIds?.upstream || []) add(id, node.id);
      walk(node.children);
    }
  };
  walk(nodes);

  return {
    downstreamOf: (id) => [...(downstream.get(id) || [])],
    upstreamOf: (id) => [...(upstream.get(id) || [])],
    has: (from, to) => downstream.get(from)?.has(to) ?? false,
  };
}

export default buildLinkIndex;
