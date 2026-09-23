import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import redis from '../../redis.js';
import { handleDeleteNode } from './deleteNode.js';
import { NodeIndex } from '../../services/nodeIndex.js';

// The index module reaches the logger only, but the operations around it
// reach the Redis client, which connects on import.
after(() => redis.disconnect());

const node = (id, children = []) => ({ id, title: id, nodeType: 'dao', nodeSubtype: children.length ? 'withChildren' : 'simple', children });
const edge = (source, target) => ({ id: `${source}->${target}`, source, target });
const pairs = (graph) => graph.edges.map((e) => `${e.source}->${e.target}`).sort();

// A group with a chain inside, a task outside it, and one arrow crossing in.
const aGraph = () => ({
  nodes: [
    node('trip', [node('visa'), node('tickets', [node('compare')]), node('packed')]),
    node('outside'),
    node('other'),
  ],
  edges: [
    edge('visa', 'tickets'),
    edge('tickets', 'packed'),
    edge('compare', 'visa'),        // from a grandchild
    edge('outside', 'visa'),        // across levels, into the group
    edge('outside', 'other'),       // unrelated
    edge('trip', 'other'),          // the group itself
  ],
});

test('deleting a node takes the edges of everything inside it along', () => {
  const graph = aGraph();

  assert.equal(handleDeleteNode(graph, { nodeId: 'trip' }), true);

  assert.deepEqual(pairs(graph), ['outside->other']);
});

test('the same with the index in play', () => {
  const graph = aGraph();
  const index = new NodeIndex();
  index.buildIndex(graph);

  assert.equal(handleDeleteNode(graph, { nodeId: 'tickets' }, index), true);

  assert.deepEqual(pairs(graph), ['outside->other', 'outside->visa', 'trip->other']);
  assert.equal(index.getNode('compare'), null);
});

test('links kept on the remaining nodes stop naming what was deleted', () => {
  const graph = aGraph();
  graph.nodes[1].linkedNodeIds = { upstream: [], downstream: ['visa', 'other'] };

  handleDeleteNode(graph, { nodeId: 'trip' });

  assert.deepEqual(graph.nodes[0].linkedNodeIds.downstream, ['other']);
});

test('deleting a node twice changes nothing the second time', () => {
  const graph = aGraph();
  handleDeleteNode(graph, { nodeId: 'trip' });
  const after = JSON.stringify(graph);

  assert.equal(handleDeleteNode(graph, { nodeId: 'trip' }), false);
  assert.equal(JSON.stringify(graph), after);
});
