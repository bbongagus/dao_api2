// dao_api2/src/ai/graphShape.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeProposalShape } from './graphShape.js';

const add = (alias, nodeType, nodeSubtype, extra = {}) => ({
  op: 'add', alias, parent: 'sec', title: alias, description: '',
  nodeType, nodeSubtype, x: 0, y: 0, downstream: [], ...extra,
});
const link = (source, target) => ({ op: 'link', source, target });
const section = { ...add('sec', 'fundamental', 'category'), parent: null };

// a → b → M1 ; M1 → c ; d → c ; c → M2   (two stages, c is a merge point)
const staged = [
  section,
  add('a', 'dao', 'simple', { x: 0, y: 0 }),
  add('b', 'dao', 'simple', { x: 380, y: 0 }),
  add('M1', 'fundamental', 'upstream', { x: 760, y: 0 }),
  add('d', 'dao', 'simple', { x: 0, y: 160 }),
  add('c', 'dao', 'simple', { x: 1140, y: 160 }),
  add('M2', 'fundamental', 'upstream', { x: 1520, y: 160 }),
  link('a', 'b'), link('b', 'M1'), link('M1', 'c'), link('d', 'c'), link('c', 'M2'),
];

// two Kai side by side, one pointed at the other, a habit beside them, an overlap
const parallel = [
  { ...add('root', 'fundamental', 'category'), parent: null },
  add('K1', 'fundamental', 'downstream', { x: 0, y: 0 }),
  add('t1', 'dao', 'simple', { x: 380, y: 0 }),
  add('K2', 'fundamental', 'downstream', { x: 0, y: 160 }),
  add('t2', 'dao', 'simple', { x: 380, y: 160 }),
  add('habit', 'repeatable', 'infinity', { x: 0, y: 320 }),
  add('clash', 'dao', 'simple', { x: 390, y: 10 }),
  link('K1', 't1'), link('K2', 't2'), link('K1', 'K2'),
];

test('stages that follow each other show as stage links and a merge point', () => {
  const shape = describeProposalShape(staged);

  assert.equal(shape.stageLinks, 1);
  assert.equal(shape.merges, 1);
  assert.equal(shape.nodes, 7);
  assert.equal(shape.arrows, 5);
});

test('what can start now is every task nothing but a section or Kai waits on', () => {
  assert.deepEqual(describeProposalShape(staged).startNow.sort(), ['a', 'd']);
});

test('each Mi counts its own stage, so nothing is counted twice', () => {
  const shape = describeProposalShape(staged);

  assert.deepEqual(shape.doubleCounted, []);
  assert.equal(shape.miWithoutTasks, 0);
});

test('a task two Mi both reach is reported', () => {
  const shape = describeProposalShape([
    section,
    add('a', 'dao', 'simple'),
    add('M1', 'fundamental', 'upstream', { x: 380 }),
    add('M2', 'fundamental', 'upstream', { x: 380, y: 160 }),
    link('a', 'M1'), link('a', 'M2'),
  ]);

  assert.deepEqual(shape.doubleCounted, ['a']);
});

test('a Mi with nothing but another Mi to its left is reported', () => {
  const shape = describeProposalShape([
    section,
    add('a', 'dao', 'simple'),
    add('M1', 'fundamental', 'upstream', { x: 380 }),
    add('M2', 'fundamental', 'upstream', { x: 760 }),
    link('a', 'M1'), link('M1', 'M2'),
  ]);

  assert.equal(shape.miWithoutTasks, 1);
});

test('the parallel shape has no stage links, no merges, and says what is wrong', () => {
  const shape = describeProposalShape(parallel);

  assert.equal(shape.stageLinks, 0);
  assert.equal(shape.merges, 0);
  assert.equal(shape.kaiIntoKai, 1);
  assert.deepEqual(shape.habitsBesideMilestones, ['habit']);
  assert.deepEqual(shape.overlaps, ['clash / t1']);
});

test('arrows declared on an add count as well as link operations', () => {
  const shape = describeProposalShape([
    section,
    add('a', 'dao', 'simple', { downstream: ['M1'] }),
    add('M1', 'fundamental', 'upstream', { x: 380 }),
  ]);

  assert.equal(shape.arrows, 1);
  assert.equal(shape.miWithoutTasks, 0);
});

test('checklist items inside a step are not tasks on the canvas', () => {
  const shape = describeProposalShape([
    section,
    add('step', 'dao', 'withChildren'),
    { ...add('item', 'dao', 'simple'), parent: 'step' },
  ]);

  assert.deepEqual(shape.startNow, ['step']);
  assert.deepEqual(shape.overlaps, []);
});
