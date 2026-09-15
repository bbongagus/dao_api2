import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summariseStaged, shapeTurn } from './agent.js';

test('staged operations are counted by kind', () => {
  const counts = summariseStaged([
    { op: 'add' }, { op: 'add' }, { op: 'update' }, { op: 'delete' }, { op: 'link' },
  ]);

  assert.deepEqual(counts, { add: 2, update: 1, delete: 1 });
});

test('a turn that staged nothing comes back as text', () => {
  const turn = shapeTurn({ staged: [], summary: 'Ничего менять не нужно.' });

  assert.equal(turn.type, 'text');
  assert.equal(turn.message, 'Ничего менять не нужно.');
});

test('a turn that staged nothing and said nothing still says something', () => {
  const turn = shapeTurn({ staged: [], summary: '' });

  assert.equal(turn.type, 'text');
  assert.match(turn.message, /\p{L}/u);
});

test('a turn with operations carries them, a summary and counts', () => {
  const turn = shapeTurn({
    staged: [{ op: 'add', alias: 'x' }, { op: 'delete', target: 'real-1' }],
    summary: 'Добавил одно, убрал другое.',
  });

  assert.equal(turn.type, 'changes');
  assert.equal(turn.operations.length, 2);
  assert.equal(turn.summary, 'Добавил одно, убрал другое.');
  assert.deepEqual(turn.counts, { add: 1, update: 0, delete: 1 });
});

test('a runaway set is refused rather than offered', () => {
  const staged = Array.from({ length: 31 }, () => ({ op: 'add' }));

  const turn = shapeTurn({ staged, summary: 'всё сразу' });

  assert.equal(turn.type, 'text');
  assert.match(turn.message, /31/);
});

test('a turn that ran out of iterations still offers what it staged', () => {
  const turn = shapeTurn({
    staged: [{ op: 'add', alias: 'x' }],
    summary: 'Начал разбирать.',
    stoppedEarly: true,
  });

  assert.equal(turn.type, 'changes');
  assert.match(turn.summary, /Начал разбирать/);
  assert.match(turn.summary, /\p{L}/u);
  assert.notEqual(turn.summary, 'Начал разбирать.', 'the summary says it stopped early');
});
