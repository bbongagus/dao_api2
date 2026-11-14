/**
 * A fork's arrows are alternatives. What only the options not taken lead to
 * is folded; before a choice, every branch is pending. The cases are the
 * editor's own (graphy/stores/__tests__/forks.test.js): the two must agree
 * on what is out of the plan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { forkSets, forkSetsOf } from './forks.js';
import { buildLinkIndex } from './links.js';

const walker = (arrows) => (id) => arrows[id] || [];
const sorted = (set) => [...set].sort();

// F ─ a1 ─ a2 ─┐
//   ─ b1 ──────┼─ join ─ tail
//   ─ c1 ─ c2 ─┘
const THREE = {
  F: ['a1', 'b1', 'c1'], a1: ['a2'], a2: ['join'], b1: ['join'], c1: ['c2'], c2: ['join'], join: ['tail'],
};
const three = (choice) => forkSets([{ id: 'F', choice, targets: ['a1', 'b1', 'c1'] }], walker(THREE));

test('folds what only the options not taken lead to, and keeps where they meet', () => {
  const { folded, pending } = three('b1');
  assert.deepEqual(sorted(folded), ['a1', 'a2', 'c1', 'c2']);
  assert.deepEqual(sorted(pending), []);
});

test('holds every branch pending until a choice, but not what all of them reach', () => {
  const { folded, pending } = three(null);
  assert.deepEqual(sorted(pending), ['a1', 'a2', 'b1', 'c1', 'c2']);
  assert.deepEqual(sorted(folded), []);
});

test('reads a choice that is no longer one of the arrows as no choice', () => {
  const { folded, pending } = three('deleted-node');
  assert.deepEqual(sorted(pending), ['a1', 'a2', 'b1', 'c1', 'c2']);
  assert.deepEqual(sorted(folded), []);
});

test('holds nothing pending when there is one arrow: nothing to choose between', () => {
  const { folded, pending } = forkSets([{ id: 'F', choice: null, targets: ['a1'] }], walker({ F: ['a1'], a1: ['join'] }));
  assert.deepEqual(sorted(pending), []);
  assert.deepEqual(sorted(folded), []);
});

test('keeps a step two options share when one of them is taken', () => {
  // a1 and b1 both go through x; c1 goes straight to the join.
  const arrows = { F: ['a1', 'b1', 'c1'], a1: ['x'], b1: ['x'], x: ['join'], c1: ['join'] };
  const { folded } = forkSets([{ id: 'F', choice: 'a1', targets: ['a1', 'b1', 'c1'] }], walker(arrows));
  assert.deepEqual(sorted(folded), ['b1', 'c1']);
});

test('lets a fork inside a folded branch fold with it, taking nothing past the outer join', () => {
  // The inner fork G is undecided and one of its options never reaches the
  // join: on its own it would hold the join pending.
  const arrows = { F: ['a1', 'b1'], a1: ['G'], G: ['g1', 'g2'], g1: ['join'], b1: ['join'], join: ['tail'] };
  const { folded, pending } = forkSets([
    { id: 'G', choice: null, targets: ['g1', 'g2'] },
    { id: 'F', choice: 'b1', targets: ['a1', 'b1'] },
  ], walker(arrows));
  assert.deepEqual(sorted(folded), ['G', 'a1', 'g1', 'g2']);
  assert.deepEqual(sorted(pending), []);
});

test('applies a fork inside the branch taken', () => {
  const arrows = { F: ['a1', 'b1'], a1: ['G'], G: ['g1', 'g2'], g1: ['join'], g2: ['join'], b1: ['join'] };
  const { folded, pending } = forkSets([
    { id: 'F', choice: 'a1', targets: ['a1', 'b1'] },
    { id: 'G', choice: null, targets: ['g1', 'g2'] },
  ], walker(arrows));
  assert.deepEqual(sorted(folded), ['b1']);
  assert.deepEqual(sorted(pending), ['g1', 'g2']);
});

test('survives arrows that run in a circle', () => {
  const arrows = { F: ['a1', 'b1'], a1: ['F'], b1: ['join'] };
  const { folded } = forkSets([{ id: 'F', choice: 'b1', targets: ['a1', 'b1'] }], walker(arrows));
  assert.deepEqual(sorted(folded), ['a1']);
});

// --- a stored graph: the forks are nodes, and the arrows are its edges

const task = (id, extra = {}) => ({ id, title: id, nodeType: 'dao', nodeSubtype: 'simple', children: [], ...extra });
// Inside a Group: F ─ a1 ─ a2 ─┬─ join
//                   └ b1 ──────┘
const stored = (fork) => [{
  ...task('G'), nodeType: 'fundamental', nodeSubtype: 'category',
  children: [task('F', fork), task('a1'), task('a2'), task('b1'), task('join')],
}];
const arrows = [
  { source: 'F', target: 'a1' }, { source: 'a1', target: 'a2' }, { source: 'a2', target: 'join' },
  { source: 'F', target: 'b1' }, { source: 'b1', target: 'join' },
];
const setsOf = (nodes, edges) => forkSetsOf(nodes, buildLinkIndex(nodes, edges));

test('a stored fork is read from the graph edges, wherever it is nested', () => {
  const { folded, pending } = setsOf(stored({ fork: true, choice: 'b1' }), arrows);
  assert.deepEqual(sorted(folded), ['a1', 'a2']);
  assert.deepEqual(sorted(pending), []);
});

test('a stored fork with no choice field yet holds its branches pending', () => {
  const { folded, pending } = setsOf(stored({ fork: true }), arrows);
  assert.deepEqual(sorted(folded), []);
  assert.deepEqual(sorted(pending), ['a1', 'a2', 'b1']);
});

test('a task that is not a fork leaves everything in the plan, whatever its choice says', () => {
  const { folded, pending } = setsOf(stored({ choice: 'b1' }), arrows);
  assert.deepEqual(sorted(folded), []);
  assert.deepEqual(sorted(pending), []);
});
