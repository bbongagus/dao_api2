import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import redis from '../../redis.js';
import { handleMoveNode } from './moveNode.js';
import { routeOperation } from './index.js';

// The operations table reaches updateNode.js, which reaches the Redis client,
// which connects on import.
after(() => redis.disconnect());

const node = (id, children = []) => ({ id, title: id, nodeType: 'dao', nodeSubtype: children.length ? 'withChildren' : 'simple', children });
const ids = (list) => list.map((n) => n.id);

test('a top-level node moves inside another, keeping its own children', () => {
  const graph = { nodes: [node('a', [node('a1')]), node('g')], edges: [] };

  assert.equal(handleMoveNode(graph, { nodeId: 'a', parentId: 'g' }), true);

  assert.deepEqual(ids(graph.nodes), ['g']);
  assert.deepEqual(ids(graph.nodes[0].children), ['a']);
  assert.deepEqual(ids(graph.nodes[0].children[0].children), ['a1']);
});

test('a nested node moves back to the top level', () => {
  const graph = { nodes: [node('g', [node('a'), node('b')])], edges: [] };

  assert.equal(handleMoveNode(graph, { nodeId: 'a', parentId: null }), true);

  assert.deepEqual(ids(graph.nodes), ['g', 'a']);
  assert.deepEqual(ids(graph.nodes[0].children), ['b']);
});

test('a move to where the node already is changes nothing and is not a failure', () => {
  const graph = { nodes: [node('g', [node('a'), node('b')])], edges: [] };

  assert.equal(handleMoveNode(graph, { nodeId: 'a', parentId: 'g' }), true);

  assert.deepEqual(ids(graph.nodes[0].children), ['a', 'b']);
});

test('a node cannot move inside itself or its own descendant', () => {
  const graph = { nodes: [node('a', [node('a1', [node('a2')])])], edges: [] };

  assert.equal(handleMoveNode(graph, { nodeId: 'a', parentId: 'a' }), false);
  assert.equal(handleMoveNode(graph, { nodeId: 'a', parentId: 'a2' }), false);

  assert.deepEqual(ids(graph.nodes), ['a']);
});

test('a move of an unknown node, or into an unknown parent, fails and changes nothing', () => {
  const graph = { nodes: [node('a'), node('g')], edges: [] };

  assert.equal(handleMoveNode(graph, { nodeId: 'nope', parentId: 'g' }), false);
  assert.equal(handleMoveNode(graph, { nodeId: 'a', parentId: 'nope' }), false);

  assert.deepEqual(ids(graph.nodes), ['a', 'g']);
});

test('the edges of a moved node stay', () => {
  const graph = { nodes: [node('a'), node('b'), node('g')], edges: [{ id: 'e', source: 'a', target: 'b' }] };

  handleMoveNode(graph, { nodeId: 'a', parentId: 'g' });

  assert.equal(graph.edges.length, 1);
});

test('MOVE_NODE is an operation the server routes', () => {
  const graph = { nodes: [node('a'), node('g')], edges: [] };

  assert.equal(routeOperation('MOVE_NODE', graph, { nodeId: 'a', parentId: 'g' }, 'main', null, 'u1'), true);

  assert.deepEqual(ids(graph.nodes[0].children), ['a']);
});
