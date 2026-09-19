import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleAddNode } from './addNode.js';

test('a node added with a description keeps it', () => {
  const graph = { nodes: [], edges: [] };

  handleAddNode(graph, { id: 'n1', title: 'Read the book', description: 'Chapters 1-3 first' });

  assert.equal(graph.nodes[0].description, 'Chapters 1-3 first');
});

test('a node added without a description gets an empty one', () => {
  const graph = { nodes: [], edges: [] };

  handleAddNode(graph, { id: 'n1', title: 'Read the book' });

  assert.equal(graph.nodes[0].description, '');
});

test('a child added under a parent keeps its description too', () => {
  const graph = { nodes: [{ id: 'p', nodeType: 'dao', nodeSubtype: 'simple', children: [] }], edges: [] };

  handleAddNode(graph, { id: 'c', title: 'Step', description: 'why this step', parentId: 'p' });

  assert.equal(graph.nodes[0].children[0].description, 'why this step');
});
