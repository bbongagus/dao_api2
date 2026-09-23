/**
 * Drop the edges, and the editor's linkedNodeIds, that name nodes no longer in
 * the graph. Until 2026-09-23 deleting a node on the server removed only its
 * own edges, so every arrow between its descendants stayed behind pointing at
 * nothing (deleteNode.js now removes them). This clears what was left.
 *
 * Pure: returns a new graph and leaves the one it was given alone.
 *
 * @returns {{ graph: object, edgesRemoved: number, linksRemoved: number }}
 */
export function pruneOrphanEdges(input) {
  const graph = structuredClone(input);
  const ids = new Set();
  const collect = (nodes) => (nodes || []).forEach((node) => { ids.add(node.id); collect(node.children); });
  collect(graph.nodes);

  const edges = graph.edges || [];
  const kept = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const edgesRemoved = edges.length - kept.length;
  if (graph.edges) graph.edges = kept;

  let linksRemoved = 0;
  const prune = (nodes) => (nodes || []).forEach((node) => {
    const links = node.linkedNodeIds;
    for (const side of ['upstream', 'downstream']) {
      if (!Array.isArray(links?.[side])) continue;
      const left = links[side].filter((id) => ids.has(id));
      linksRemoved += links[side].length - left.length;
      links[side] = left;
    }
    prune(node.children);
  });
  prune(graph.nodes);

  return { graph, edgesRemoved, linksRemoved };
}
