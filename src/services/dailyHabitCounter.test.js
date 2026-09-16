import { test } from 'node:test';
import assert from 'node:assert/strict';

import { habitUpdates, runHabitCounter } from './dailyHabitCounter.js';

const node = (id, extra = {}) => ({
  id, title: id, nodeType: 'dao', nodeSubtype: 'simple', isDone: false, children: [], ...extra,
});
const habit = (id, subtype, extra = {}) =>
  node(id, { nodeType: 'repeatable', nodeSubtype: subtype, currentCompletions: 0, ...extra });

// --- which nodes one graph counts ---

test('a ticked habit, bounded or infinity, counts one more day and starts unticked', () => {
  const graph = { nodes: [
    habit('run', 'bounded', { isDone: true, currentCompletions: 4, requiredCompletions: 30 }),
    habit('read', 'infinity', { isDone: true, currentCompletions: 11 }),
  ] };

  assert.deepEqual(habitUpdates(graph), [
    { id: 'run', updates: { currentCompletions: 5, isDone: false } },
    { id: 'read', updates: { currentCompletions: 12, isDone: false } },
  ]);
});

test('an unticked habit is left alone', () => {
  assert.deepEqual(habitUpdates({ nodes: [habit('run', 'bounded', { currentCompletions: 4 })] }), []);
});

test('habits nested inside other nodes are found', () => {
  const graph = { nodes: [
    node('health', { nodeType: 'fundamental', nodeSubtype: 'category', children: [
      node('morning', { nodeSubtype: 'withChildren', children: [habit('stretch', 'infinity', { isDone: true })] }),
    ] }),
  ] };

  assert.deepEqual(habitUpdates(graph), [{ id: 'stretch', updates: { currentCompletions: 1, isDone: false } }]);
});

test('ticked tasks and milestones are not habits', () => {
  const graph = { nodes: [
    node('task', { isDone: true }),
    node('stage', { nodeType: 'fundamental', nodeSubtype: 'upstream', isDone: true }),
  ] };

  assert.deepEqual(habitUpdates(graph), []);
});

test('a habit that never had a count starts from zero', () => {
  const graph = { nodes: [habit('new', 'bounded', { isDone: true, currentCompletions: undefined })] };

  assert.deepEqual(habitUpdates(graph), [{ id: 'new', updates: { currentCompletions: 1, isDone: false } }]);
});

// --- the run over every user's graphs ---

async function* listOf(items) {
  for (const item of items) yield item;
}

function harness(graphsByOwner, { failOn = null, refuse = null } = {}) {
  const applied = [];
  const broadcasts = [];
  const errors = [];
  const deps = {
    graphs: listOf(Object.keys(graphsByOwner).map((owner) => {
      const [userId, graphId] = owner.split('/');
      return { userId, graphId };
    })),
    getGraph: async (graphId, userId) => {
      if (`${userId}/${graphId}` === failOn) return null;
      return structuredClone(graphsByOwner[`${userId}/${graphId}`]);
    },
    applyOperation: async (graphId, operation, userId) => {
      applied.push({ userId, graphId, operation });
      return operation.payload.id === refuse ? null : { nodes: [] };
    },
    broadcast: (target, message) => broadcasts.push({ target, message }),
    log: { error: (text) => errors.push(text) },
  };
  return { deps, applied, broadcasts, errors };
}

test("every user's graph is counted, each change through the queue and broadcast to its own user", async () => {
  const h = harness({
    'alice/main': { nodes: [habit('run', 'bounded', { isDone: true, currentCompletions: 1 })] },
    'bob/main': { nodes: [habit('read', 'infinity', { isDone: true })] },
    'carol/main': { nodes: [habit('swim', 'bounded')] },
  });

  const result = await runHabitCounter(h.deps);

  assert.deepEqual(result, { graphs: 3, nodes: 2, failed: 0, refused: 0 });
  assert.deepEqual(h.applied, [
    { userId: 'alice', graphId: 'main', operation: { type: 'UPDATE_NODE', payload: { id: 'run', updates: { currentCompletions: 2, isDone: false } } } },
    { userId: 'bob', graphId: 'main', operation: { type: 'UPDATE_NODE', payload: { id: 'read', updates: { currentCompletions: 1, isDone: false } } } },
  ]);
  assert.deepEqual(h.broadcasts.map((b) => b.target), [
    { userId: 'alice', graphId: 'main' },
    { userId: 'bob', graphId: 'main' },
  ]);
  assert.equal(h.broadcasts[0].message.type, 'OPERATION_APPLIED');
  assert.equal(h.broadcasts[0].message.clientId, 'server');
  assert.equal(h.broadcasts[0].message.userId, 'alice');
  assert.deepEqual(h.broadcasts[0].message.payload, h.applied[0].operation);
});

test('a change the queue refused is not counted or broadcast, and does not stop the rest', async () => {
  // A second habit after the refused one, and a second graph after that:
  // a stray `break` where the code means `continue` would leave both unapplied.
  const h = harness({
    'alice/main': { nodes: [
      habit('gone', 'bounded', { isDone: true }),
      habit('stays', 'infinity', { isDone: true }),
    ] },
    'bob/main': { nodes: [habit('read', 'infinity', { isDone: true })] },
  }, { refuse: 'gone' });

  const result = await runHabitCounter(h.deps);

  assert.deepEqual(result, { graphs: 2, nodes: 2, failed: 0, refused: 1 });
  assert.deepEqual(h.applied.map((a) => a.operation.payload.id), ['gone', 'stays', 'read']);
  assert.deepEqual(h.broadcasts.map((b) => b.message.payload.payload.id), ['stays', 'read']);
});

test('a graph that fails does not stop the others', async () => {
  const h = harness({
    'alice/main': { nodes: [habit('run', 'bounded', { isDone: true })] },
    'bob/main': { nodes: [habit('read', 'infinity', { isDone: true })] },
  }, { failOn: 'alice/main' });

  const result = await runHabitCounter(h.deps);

  assert.deepEqual(result, { graphs: 2, nodes: 1, failed: 1, refused: 0 });
  assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].userId, 'bob');
  assert.match(h.errors[0], /alice:main/);
});
