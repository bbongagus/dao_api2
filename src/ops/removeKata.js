/**
 * Take every Kata (repeatable node) out of a stored graph: the node, what is
 * nested inside it, every edge touching any of them, and every mention in
 * another node's linkedNodeIds. Pure — scripts/remove-kata.js does the I/O.
 */

const isKata = (node) => node?.nodeType === 'repeatable';

const walk = (nodes, visit) => {
  for (const node of nodes || []) {
    visit(node);
    walk(node.children, visit);
  }
};

export function removeKata(graph) {
  const removed = new Set();
  walk(graph.nodes, (node) => {
    if (isKata(node)) walk([node], (inside) => removed.add(inside.id));
  });
  if (removed.size === 0) return { graph, removedIds: [], edgesRemoved: 0 };

  const keep = (id) => !removed.has(id);
  const clean = (nodes) => (nodes || [])
    .filter((node) => keep(node.id))
    .map((node) => ({
      ...node,
      ...(node.children ? { children: clean(node.children) } : {}),
      ...(node.linkedNodeIds ? {
        linkedNodeIds: {
          ...node.linkedNodeIds,
          upstream: (node.linkedNodeIds.upstream || []).filter(keep),
          downstream: (node.linkedNodeIds.downstream || []).filter(keep),
        },
      } : {}),
    }));

  const before = graph.edges || [];
  const edges = before.filter((e) => keep(e.source) && keep(e.target));

  return {
    graph: { ...graph, nodes: clean(graph.nodes), edges, version: (graph.version || 0) + 1 },
    removedIds: [...removed],
    edgesRemoved: before.length - edges.length,
  };
}
