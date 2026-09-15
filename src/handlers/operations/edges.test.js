import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleAddEdge } from './edges.js';

test('an edge between a pair that is already connected is not stored again', () => {
  const graph = { nodes: [], edges: [{ id: 'e1', source: 'a', target: 'b', type: 'floating' }] };

  const ok = handleAddEdge(graph, { id: 'e2', source: 'a', target: 'b' });

  assert.equal(ok, true, 'a duplicate is not a failure');
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].id, 'e1');
});

test('the reverse pair is a different edge and is stored', () => {
  const graph = { nodes: [], edges: [{ id: 'e1', source: 'a', target: 'b', type: 'floating' }] };

  handleAddEdge(graph, { id: 'e2', source: 'b', target: 'a' });

  assert.equal(graph.edges.length, 2);
});
