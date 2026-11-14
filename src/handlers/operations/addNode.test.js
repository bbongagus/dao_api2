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

// A fork is a task whose arrows are alternatives. The node is built from a
// whitelist, so a field not named here is dropped without a word.

test('a fork added with its options keeps being a fork, with no choice made', () => {
  const graph = { nodes: [], edges: [] };

  handleAddNode(graph, {
    id: 'f', title: 'Which way?', fork: true, choice: null,
    forkOptions: [{ target: 'a1', label: 'By land', hint: 'Two steps' }],
  });

  assert.equal(graph.nodes[0].fork, true);
  assert.equal(graph.nodes[0].choice, null);
  assert.deepEqual(graph.nodes[0].forkOptions, [{ target: 'a1', label: 'By land', hint: 'Two steps' }]);
});

test('a fork added already chosen at keeps its choice', () => {
  const graph = { nodes: [], edges: [] };

  handleAddNode(graph, { id: 'f', title: 'Which way?', fork: true, choice: 'b1', isDone: true });

  assert.equal(graph.nodes[0].choice, 'b1');
  assert.equal(graph.nodes[0].isDone, true);
});

test('only the fork fields the payload carries are stored', () => {
  const graph = { nodes: [], edges: [] };

  handleAddNode(graph, { id: 'f', title: 'Which way?', fork: true });

  assert.equal(graph.nodes[0].fork, true);
  assert.equal('choice' in graph.nodes[0], false);
  assert.equal('forkOptions' in graph.nodes[0], false);
});

test('a node added without fork fields is stored exactly as before', () => {
  const graph = { nodes: [], edges: [] };

  handleAddNode(graph, { id: 'n1', title: 'Read the book' });

  assert.deepEqual(graph.nodes[0], {
    id: 'n1',
    title: 'Read the book',
    description: '',
    nodeType: 'dao',
    nodeSubtype: 'simple',
    position: { x: 0, y: 0 },
    isDone: false,
    currentCompletions: 0,
    requiredCompletions: 1,
    calculatedProgress: 0,
    linkedNodeIds: {},
    children: [],
  });
  assert.deepEqual(Object.keys(graph.nodes[0]), [
    'id', 'title', 'description', 'nodeType', 'nodeSubtype', 'position', 'isDone',
    'currentCompletions', 'requiredCompletions', 'calculatedProgress', 'linkedNodeIds', 'children',
  ]);
});
