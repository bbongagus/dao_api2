import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pruneOrphanEdges } from './pruneOrphanEdges.js';

const node = (id, children = [], linkedNodeIds) => ({ id, children, ...(linkedNodeIds ? { linkedNodeIds } : {}) });
const edge = (source, target) => ({ id: `${source}->${target}`, source, target });

test('edges to or from a node that is gone are dropped; the rest stay as they were', () => {
  const graph = {
    nodes: [node('a', [node('a1')]), node('b')],
    edges: [edge('a', 'b'), edge('a1', 'b'), edge('gone1', 'gone2'), edge('b', 'gone1')],
  };

  const { graph: pruned, edgesRemoved } = pruneOrphanEdges(graph);

  assert.equal(edgesRemoved, 2);
  assert.deepEqual(pruned.edges.map((e) => e.id), ['a->b', 'a1->b']);
});

test('linkedNodeIds stop naming nodes that are gone, at any depth', () => {
  const graph = {
    nodes: [node('a', [node('a1', [], { upstream: ['gone', 'a'], downstream: [] })], { upstream: [], downstream: ['a1', 'gone'] })],
    edges: [],
  };

  const { graph: pruned, linksRemoved } = pruneOrphanEdges(graph);

  assert.equal(linksRemoved, 2);
  assert.deepEqual(pruned.nodes[0].linkedNodeIds.downstream, ['a1']);
  assert.deepEqual(pruned.nodes[0].children[0].linkedNodeIds.upstream, ['a']);
});

test('a clean graph comes back with nothing counted, and the input is never touched', () => {
  const graph = { nodes: [node('a'), node('b')], edges: [edge('a', 'b'), edge('x', 'a')] };
  const before = JSON.stringify(graph);

  const { edgesRemoved } = pruneOrphanEdges(graph);
  assert.equal(edgesRemoved, 1);
  assert.equal(JSON.stringify(graph), before);

  const clean = pruneOrphanEdges({ nodes: [node('a')], edges: [] });
  assert.equal(clean.edgesRemoved + clean.linksRemoved, 0);
});

test('a graph with no edges array keeps having none', () => {
  const { graph } = pruneOrphanEdges({ nodes: [node('a')] });
  assert.equal('edges' in graph, false);
});
