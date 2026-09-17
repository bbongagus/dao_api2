import { test } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';

import { describeOperation, formatEntry, createJournal } from './journal.js';

const node = (id, title, extra = {}) => ({
  id, title, nodeType: 'dao', nodeSubtype: 'simple', description: '', children: [], ...extra,
});

const graph = () => ({
  nodes: [
    node('cat', 'Гражданство', {
      nodeType: 'fundamental', nodeSubtype: 'category',
      children: [node('stage', 'Подтверждение', { nodeType: 'fundamental' })],
    }),
    node('task', 'Собрать документы'),
  ],
  edges: [{ id: 'e1', source: 'stage', target: 'task' }],
});

// --- what an operation changed, read before it is applied ---

test('an update records each field it changes, from and to', () => {
  const change = describeOperation(graph(), {
    type: 'UPDATE_NODE',
    payload: { nodeId: 'stage', updates: { nodeSubtype: 'downstream', description: 'Веха' } },
  });

  assert.equal(change.title, 'Подтверждение');
  assert.deepEqual(change.changes, {
    nodeSubtype: { from: 'simple', to: 'downstream' },
    description: { from: '', to: 'Веха' },
  });
});

test('an update that changes nothing but derived progress is not worth a line', () => {
  const change = describeOperation(graph(), {
    type: 'UPDATE_NODE',
    payload: { nodeId: 'task', updates: { calculatedProgress: 0.5, nodeSubtype: 'simple' } },
  });

  assert.equal(change, null);
});

test('dragging a node or the canvas is not journalled', () => {
  assert.equal(describeOperation(graph(), { type: 'UPDATE_NODE_POSITION', payload: { nodeId: 'task', position: { x: 1, y: 2 } } }), null);
  assert.equal(describeOperation(graph(), { type: 'UPDATE_VIEWPORT', payload: { x: 0, y: 0, zoom: 1 } }), null);
});

test('an edge is recorded by the titles it connects', () => {
  const change = describeOperation(graph(), {
    type: 'ADD_EDGE', payload: { id: 'e2', source: 'task', target: 'stage' },
  });

  assert.deepEqual(change.source, { id: 'task', title: 'Собрать документы' });
  assert.deepEqual(change.target, { id: 'stage', title: 'Подтверждение' });
  assert.equal(change.duplicate, false);
});

test('an edge between a pair already connected is marked as a duplicate', () => {
  const change = describeOperation(graph(), {
    type: 'ADD_EDGE', payload: { id: 'e2', source: 'stage', target: 'task' },
  });

  assert.equal(change.duplicate, true);
});

test('a deleted edge is recorded by the titles it connected', () => {
  const change = describeOperation(graph(), { type: 'DELETE_EDGE', payload: { edgeId: 'e1' } });

  assert.equal(change.source.title, 'Подтверждение');
  assert.equal(change.target.title, 'Собрать документы');
});

test('a deleted node keeps its title in the record', () => {
  const change = describeOperation(graph(), { type: 'DELETE_NODE', payload: { nodeId: 'task' } });

  assert.equal(change.title, 'Собрать документы');
});

// --- reading the journal as a person ---

test('an update reads as the node and what moved', () => {
  const out = formatEntry({
    kind: 'operation', at: '2026-09-15T11:55:13.000Z', type: 'UPDATE_NODE', nodeId: 'stage', title: 'Подтверждение',
    changes: { nodeSubtype: { from: 'simple', to: 'downstream' } },
  });

  assert.match(out, /UPDATE_NODE/);
  assert.match(out, /«Подтверждение»/);
  assert.match(out, /nodeSubtype: "simple" → "downstream"/);
});

test('a duplicate edge says it was not stored', () => {
  const out = formatEntry({
    kind: 'operation', at: '2026-09-15T11:55:13.000Z', type: 'ADD_EDGE', edgeId: 'e2',
    source: { id: 'stage', title: 'Подтверждение' }, target: { id: 'task', title: 'Собрать документы' }, duplicate: true,
  });

  assert.match(out, /«Подтверждение» → «Собрать документы»/);
  assert.match(out, /duplicate/);
});

test('an agent turn reads as the request, each tool call, and the outcome', () => {
  const out = formatEntry({
    kind: 'agent_turn', at: '2026-09-15T11:55:13.000Z',
    request: 'Давай попробуем',
    tools: [
      { name: 'inspect', input: { alias: 'n15', depth: 2 }, result: 'n15 [ryu] Citizenship Bulgaria · 16 inside\n  n16 …' },
      { name: 'link_nodes', input: { source: 'n16', target: 'n17' }, result: 'Staged: n16 → n17.' },
    ],
    result: { type: 'changes', summary: 'Разбил на этапы.', operations: [{ op: 'link' }], counts: { add: 0, update: 0, delete: 0 } },
  });

  assert.match(out, /Давай попробуем/);
  assert.match(out, /inspect .*n15/);
  assert.match(out, /Staged: n16 → n17/);
  assert.match(out, /1 operation/);
  assert.match(out, /Разбил на этапы/);
});

// --- the store itself, against a real Redis when one is running ---

const redis = new Redis({ lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
const redisUp = await redis.connect().then(() => true, () => false);

test('entries come back newest first, as many as asked for', { skip: !redisUp && 'no Redis on localhost' }, async (t) => {
  const user = `journal-test-${Date.now()}`;
  t.after(async () => { await redis.del(`journal:${user}:main`); await redis.quit(); });
  const journal = createJournal(redis);

  await journal.record(user, 'main', { kind: 'operation', type: 'ADD_EDGE', edgeId: 'first' });
  await journal.record(user, 'main', { kind: 'operation', type: 'ADD_EDGE', edgeId: 'second' });
  await journal.record(user, 'main', { kind: 'operation', type: 'ADD_EDGE', edgeId: 'third' });

  const entries = await journal.read(user, 'main', { limit: 2 });

  assert.deepEqual(entries.map((e) => e.edgeId), ['third', 'second']);
  assert.ok(entries[0].at, 'every entry is stamped with when it happened');
});

test('a journal is per user: the same graph name does not share one', { skip: !redisUp && 'no Redis on localhost' }, async (t) => {
  const a = `journal-test-a-${Date.now()}`;
  const b = `journal-test-b-${Date.now()}`;
  const local = new Redis();
  t.after(async () => { await local.del(`journal:${a}:main`, `journal:${b}:main`); await local.quit(); });
  const journal = createJournal(local);

  await journal.record(a, 'main', { kind: 'operation', type: 'DELETE_NODE', title: 'чужое' });

  assert.deepEqual(await journal.read(b, 'main'), []);
});

test('an agent answer spread over paragraphs still reads as one outcome line', () => {
  const out = formatEntry({
    kind: 'agent_turn', at: '2026-09-15T11:55:13.000Z', request: 'что тут?', tools: [],
    result: { type: 'text', message: 'Первая строка.\n\n**Вторая**\n- третья' },
  });

  assert.equal(out.split('\n').length, 2, 'the request line and the outcome line');
  assert.match(out, /Первая строка\. \*\*Вторая\*\* - третья/);
});

test('an agent turn shows what it cost — tokens and dollars, over every call it made', () => {
  const out = formatEntry({
    kind: 'agent_turn', at: '2026-09-15T11:55:13.000Z',
    request: 'Построй план',
    tools: [],
    usage: { calls: 9, input: 48120, output: 1840, cacheRead: 31000, cacheWrite: 6200, dollars: 0.1234 },
    result: { type: 'text', message: 'Готово.' },
  });

  assert.match(out, /\$0\.1234/, 'the dollars are shown');
  assert.match(out, /9 calls/, 'and how many API calls it took');
  assert.match(out, /48120 in/);
  assert.match(out, /1840 out/);
  assert.match(out, /31000 cached/);
});

test('a turn recorded before costs were measured still renders', () => {
  const out = formatEntry({
    kind: 'agent_turn', at: '2026-09-15T11:55:13.000Z', request: 'Старая запись',
    tools: [], result: { type: 'text', message: 'Готово.' },
  });

  assert.match(out, /Старая запись/);
  assert.doesNotMatch(out, /\$/);
});
