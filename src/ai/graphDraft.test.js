import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAliasTable } from './aliases.js';
import { projectDraft } from './graphDraft.js';
import { createReadTools } from './graphReadTools.js';
import { createWriteTools } from './graphWriteTools.js';

const task = (id, extra = {}) => ({ id, title: id, nodeType: 'dao', nodeSubtype: 'simple', children: [], ...extra });
const nodes = [task('area', { nodeType: 'fundamental', nodeSubtype: 'category', children: [
  task('topic', { isDone: true, doneAt: '2026-09-24T12:00:00Z', linkedNodeIds: { downstream: ['write'] } }), task('write'),
] }), task('outside')];
const group = { op: 'add', alias: 'week', parent: 'area', title: 'Week 1', nodeType: 'fundamental', nodeSubtype: 'category' };

test('draft shows moves, completed work and new aliases without mutating saved data', () => {
  const before = structuredClone(nodes);
  const aliases = buildAliasTable(nodes);
  const staged = [group, { op: 'move', target: 'topic', parent: 'week' }, { op: 'move', target: 'write', parent: 'week' },
    { op: 'update', target: 'week', title: 'First week' }];
  const draft = projectDraft(nodes, [], staged, aliases);
  assert.deepEqual(nodes, before);
  assert.equal(draft.aliases.nodeAt('n2').id, 'topic');
  assert.equal(draft.aliases.nodeAt('n4').id, 'outside');
  assert.equal(draft.aliases.nodeAt('week').title, 'First week');
  assert.equal(draft.aliases.nodeAt('n2').doneAt, before[0].children[0].doneAt);
  assert.deepEqual(draft.aliases.pathOf('n2'), ['area', 'First week']);
  const read = createReadTools(draft.nodes, draft.aliases, draft.edges);
  assert.match(read.inspect({ alias: 'week' }), /n2.*topic.*done/);
  assert.match(read.inspect({ alias: 'week' }), /n2 → n3/);
  assert.doesNotMatch(createReadTools(nodes, aliases).inspect({ alias: 'n1' }), /First week/);
});

test('draft honors unlinks even when the saved node carries a linkedNodeIds copy', () => {
  const draft = projectDraft(nodes, [], [{ op: 'unlink', source: 'topic', target: 'write' }], buildAliasTable(nodes));
  assert.doesNotMatch(createReadTools(draft.nodes, draft.aliases, draft.edges).inspect({ alias: 'n1' }), /n2 → n3/);
});

test('draft supports additions with forward parents, ticks, links and leaf deletion', () => {
  const draft = projectDraft(nodes, [], [
    { op: 'add', alias: 'item', parent: 'week', title: 'Item', nodeType: 'dao', nodeSubtype: 'simple' }, group,
    { op: 'done', target: 'item', isDone: true }, { op: 'link', source: 'write', target: 'item' },
    { op: 'delete', target: 'outside' },
  ], buildAliasTable(nodes));
  assert.equal(draft.aliases.nodeAt('item').isDone, true);
  assert.equal(draft.aliases.nodeAt('n4'), null);
  assert.equal(draft.aliases.nodeAt('n3').id, 'write');
  assert.ok(draft.edges.some(e => e.source === 'write' && e.target === 'item'));
});

test('invalid drafts report structural mistakes instead of inventing a view', () => {
  for (const ops of [
    [{ op: 'move', target: 'area', parent: 'topic' }],
    [{ op: 'move', target: 'topic', parent: 'missing' }],
    [{ op: 'delete', target: 'area' }],
    [{ ...group, parent: 'week' }],
  ]) assert.throws(() => projectDraft(nodes, [], ops, buildAliasTable(nodes)));
});

test('start_over and plan replacement are reflected immediately in the draft', () => {
  const aliases = buildAliasTable(nodes);
  const { tools, staged } = createWriteTools(nodes, aliases);
  tools.add({ alias: 'new', parent: 'n1', title: 'New task', kind: 'dao' });
  assert.ok(projectDraft(nodes, [], staged, aliases).aliases.nodeAt('new'));
  tools.startOver();
  assert.equal(projectDraft(nodes, [], staged, aliases).aliases.nodeAt('new'), null);
  const plan = title => ({ section: 'n1', stages: [{ id: 'finish', title, steps: [{ id: 'work', title: 'Work' }] }] });
  tools.plan(plan('Old result')); tools.plan(plan('Correct result'));
  assert.equal(projectDraft(nodes, [], staged, aliases).aliases.nodeAt('plan:finish').title, 'Correct result');
});
