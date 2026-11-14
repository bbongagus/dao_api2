/**
 * A fork's arrows are alternatives. What only the options not taken lead to
 * is folded; before a choice, every branch is pending. The cases are the
 * editor's own (graphy/stores/__tests__/forks.test.js): the two must agree
 * on what is out of the plan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { forkSets, forksOf, mayFork, readForks } from './forks.js';
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

// Marked `fork` is what the person asked for; whether the node is a fork is
// read off its level: a task with nothing inside and at least two ways on.
{
  const task = (id, extra = {}) => ({ id, nodeType: 'dao', nodeSubtype: 'simple', children: [], ...extra });
  const fork = (extra = {}) => task('F', { fork: true, choice: null, ...extra });
  const TWO = { F: ['a1', 'b1'] };
  const level = (first, ...rest) => [first, task('a1'), task('b1'), ...rest];

  test('forksOf: a marked task with two arrows on its level is a fork, and its targets are the options', () => {
    assert.deepEqual(forksOf(level(fork()), walker(TWO)), [{ id: 'F', targets: ['a1', 'b1'], choice: null }]);
  });

  test('forksOf: carries the option taken when it is one of the arrows, and none when it is not', () => {
    assert.equal(forksOf(level(fork({ choice: 'b1' })), walker(TWO))[0].choice, 'b1');
    assert.equal(forksOf(level(fork({ choice: 'deleted-node' })), walker(TWO))[0].choice, null);
  });

  test('forksOf: no fork with one way on, or none: there is nothing to choose between', () => {
    assert.deepEqual(forksOf(level(fork()), walker({ F: ['a1'] })), []);
    assert.deepEqual(forksOf(level(fork()), walker({})), []);
  });

  test('forksOf: two arrows to one node are one way on', () => {
    assert.deepEqual(forksOf(level(fork()), walker({ F: ['a1', 'a1'] })), []);
  });

  test('forksOf: no fork with contents: a task that holds a level is a folder', () => {
    assert.deepEqual(forksOf(level(fork({ nodeSubtype: 'withChildren', children: [task('x')] })), walker(TWO)), []);
  });

  test('forksOf: no fork as a Group, a Track or a Milestone', () => {
    const marked = (nodeSubtype) => fork({ nodeType: 'fundamental', nodeSubtype });
    for (const subtype of ['category', 'downstream', 'upstream']) {
      assert.deepEqual(forksOf(level(marked(subtype)), walker(TWO)), []);
    }
  });

  test('forksOf: no fork without the mark, whatever its arrows', () => {
    assert.deepEqual(forksOf(level(task('F')), walker(TWO)), []);
  });

  test('mayFork says cheaply whether a level may hold one at all', () => {
    assert.equal(mayFork(level(fork())), true);
    assert.equal(mayFork(level(task('F'))), false);
    assert.equal(mayFork([]), false);
  });
}

// --- a stored graph: its forks are read level by level, and the arrows are
// its edges (links.js) - on the server `linkedNodeIds` is almost always empty.

const task = (id, extra = {}) => ({ id, title: id, nodeType: 'dao', nodeSubtype: 'simple', children: [], ...extra });
const group = (id, children) => ({ ...task(id), nodeType: 'fundamental', nodeSubtype: 'category', children });
// Inside a Group: F ─ a1 ─ a2 ─┬─ join
//                   └ b1 ──────┘
const stored = (fork) => [group('G', [task('F', fork), task('a1'), task('a2'), task('b1'), task('join')])];
const arrows = [
  { source: 'F', target: 'a1' }, { source: 'a1', target: 'a2' }, { source: 'a2', target: 'join' },
  { source: 'F', target: 'b1' }, { source: 'b1', target: 'join' },
];
const read = (nodes, edges) => readForks(nodes, buildLinkIndex(nodes, edges));

test('a stored fork is read from the graph edges, on the level it sits on', () => {
  const { forkOf, folded, pending } = read(stored({ fork: true, choice: 'b1' }), arrows);

  assert.deepEqual([...forkOf], [['F', { id: 'F', targets: ['a1', 'b1'], choice: 'b1' }]]);
  assert.deepEqual(sorted(folded), ['a1', 'a2']);
  assert.deepEqual(sorted(pending), []);
});

test('a stored fork with no choice field yet holds its branches pending', () => {
  const { forkOf, folded, pending } = read(stored({ fork: true }), arrows);

  assert.equal(forkOf.get('F').choice, null);
  assert.deepEqual(sorted(folded), []);
  assert.deepEqual(sorted(pending), ['a1', 'a2', 'b1']);
});

test('a task that is not marked is no fork and leaves everything in the plan, whatever its choice says', () => {
  const { forkOf, folded, pending } = read(stored({ choice: 'b1' }), arrows);

  assert.equal(forkOf.size, 0);
  assert.deepEqual(sorted(folded), []);
  assert.deepEqual(sorted(pending), []);
});

test('a marked task whose arrows lead into another level is no fork: no option is on its own', () => {
  const nodes = [task('F', { fork: true, choice: 'a1' }), group('H', [task('a1'), task('b1')])];
  const { forkOf, folded } = read(nodes, [{ source: 'F', target: 'a1' }, { source: 'F', target: 'b1' }]);

  assert.equal(forkOf.size, 0);
  assert.deepEqual(sorted(folded), []);
});

test('a marked task left with one way on is a task again, and folds nothing', () => {
  const { forkOf, folded, pending } = read(stored({ fork: true, choice: 'a1' }), arrows.slice(0, 3));

  assert.equal(forkOf.size, 0);
  assert.deepEqual(sorted(folded), []);
  assert.deepEqual(sorted(pending), []);
});

test('forks on different levels are each read on their own', () => {
  const nodes = [
    task('F', { fork: true, choice: 'x' }), task('x'), task('y'),
    group('G', [task('K', { fork: true }), task('k1'), task('k2')]),
  ];
  const { forkOf, folded, pending } = read(nodes, [
    { source: 'F', target: 'x' }, { source: 'F', target: 'y' },
    { source: 'K', target: 'k1' }, { source: 'K', target: 'k2' },
  ]);

  assert.deepEqual(sorted(forkOf.keys()), ['F', 'K']);
  assert.deepEqual(sorted(folded), ['y']);
  assert.deepEqual(sorted(pending), ['k1', 'k2']);
});
