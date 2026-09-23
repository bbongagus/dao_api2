// dao_api2/src/ai/graphShape.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeProposalShape, garbledWords } from './graphShape.js';

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

// A1 → M1, B1 → M2 ; M1 → c, M2 → c ; c → M3   (two stages side by side, a third waits for both)
const sideBySide = [
  section,
  add('a1', 'dao', 'simple', { x: 0, y: 0 }),
  add('M1', 'fundamental', 'upstream', { x: 380, y: 0 }),
  add('b1', 'dao', 'simple', { x: 0, y: 160 }),
  add('M2', 'fundamental', 'upstream', { x: 380, y: 160 }),
  add('c', 'dao', 'withChildren', { x: 760, y: 80 }),
  add('c1', 'dao', 'simple', { parent: 'c' }),
  add('c2', 'dao', 'simple', { parent: 'c' }),
  add('M3', 'fundamental', 'upstream', { x: 1140, y: 80 }),
  link('a1', 'M1'), link('b1', 'M2'), link('M1', 'c'), link('M2', 'c'), link('c', 'M3'),
];

test('a stage that waits for two others is a stage-level merge; a step waiting on two steps is not', () => {
  assert.equal(describeProposalShape(sideBySide).stageMerges, 1);
  // In `staged`, c waits for M1 and for the step d: a merge, but only one stage feeds it.
  assert.equal(describeProposalShape(staged).stageMerges, 0);
  assert.equal(describeProposalShape(staged).merges, 1);
});

test('the canvas count leaves out checklist items, which live inside their card', () => {
  const shape = describeProposalShape(sideBySide);
  assert.equal(shape.nodes, 9);
  assert.equal(shape.canvasNodes, 7);
});

test('text a person would read as broken is found: CJK characters, words mixing two alphabets', () => {
  assert.deepEqual(garbledWords('База: LLM API и Python/TypeScript工具'), ['TypeScript工具']);
  assert.deepEqual(garbledWords('Вточуить качество, Индоеptic интервью, показа наImageView'), ['Индоеptic', 'наImageView']);
  assert.deepEqual(garbledWords('Подключить MCP-сервер к Claude Desktop, прогнать evals в CI'), []);
  assert.deepEqual(garbledWords(''), []);
});

test('the shape lists broken words in titles and descriptions', () => {
  const shape = describeProposalShape([
    section,
    add('x', 'dao', 'simple', { title: 'Шаг communityчина', description: 'нормальный текст' }),
  ]);
  assert.deepEqual(shape.garbled, ['communityчина']);
});
