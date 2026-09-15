import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { createOperationHandler } from './operationHandler.js';
import redis from '../redis.js';

// Applying UPDATE_NODE reaches dailyCompletions, which holds the shared Redis
// connection open; without this the test process never exits.
after(() => redis.disconnect());

/** A handler over one in-memory graph, with a journal that remembers what it was told. */
function harness() {
  let stored = {
    nodes: [{ id: 'stage', title: 'Подтверждение', nodeType: 'fundamental', nodeSubtype: 'simple', children: [] }],
    edges: [],
  };
  const recorded = [];
  const apply = createOperationHandler({
    getGraph: async () => structuredClone(stored),
    saveGraph: async (graphId, graph) => { stored = graph; return true; },
    addOperation: async () => true,
    analytics: null,
    journal: { record: async (userId, graphId, entry) => { recorded.push({ userId, graphId, entry }); } },
  });
  return { apply, recorded };
}

test('an applied operation is journalled with the value it replaced', async () => {
  const { apply, recorded } = harness();

  await apply('main', { type: 'UPDATE_NODE', payload: { nodeId: 'stage', updates: { nodeSubtype: 'downstream' } } }, 'user-1');

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].userId, 'user-1');
  assert.equal(recorded[0].graphId, 'main');
  assert.equal(recorded[0].entry.kind, 'operation');
  assert.deepEqual(recorded[0].entry.changes, { nodeSubtype: { from: 'simple', to: 'downstream' } });
});

test('an operation that failed is not journalled', async () => {
  const { apply, recorded } = harness();

  await apply('main', { type: 'UPDATE_NODE', payload: { nodeId: 'nowhere', updates: { title: 'x' } } }, 'user-1');

  assert.equal(recorded.length, 0);
});

test('a drag is applied but not journalled', async () => {
  const { apply, recorded } = harness();

  await apply('main', { type: 'UPDATE_NODE_POSITION', payload: { nodeId: 'stage', position: { x: 5, y: 5 } } }, 'user-1');

  assert.equal(recorded.length, 0);
});
