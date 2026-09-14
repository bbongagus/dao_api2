import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toChangeResponse, MAX_OPERATIONS } from './graphChange.js';

const level = [
  { id: 'real-1', title: 'Виза', nodeType: 'fundamental', nodeSubtype: 'downstream', children: [], linkedNodeIds: {} },
  { id: 'real-2', title: 'Оффер', nodeType: 'dao', nodeSubtype: 'simple', children: [], linkedNodeIds: {} },
  { id: 'real-3', title: 'Категория', nodeType: 'fundamental', nodeSubtype: 'category',
    children: [{ id: 'real-kid', title: 'Вложенная', nodeType: 'dao', nodeSubtype: 'simple', children: [], linkedNodeIds: {} }],
    linkedNodeIds: {} },
];
const aliases = { n1: 'real-1', n2: 'real-2', n3: 'real-3', n4: 'real-kid' };

const changes = (parsed) => toChangeResponse(parsed, aliases, level);

test('a question comes back as text and proposes nothing', () => {
  const r = changes({ kind: 'question', message: 'Какой срок?', add: [], update: [], remove: [] });

  assert.equal(r.type, 'text');
  assert.equal(r.message, 'Какой срок?');
});

test('additions carry the same node shape the editor already applies', () => {
  const r = changes({
    kind: 'changes', summary: 'Добавил ветку',
    add: [{ alias: 'a1', title: 'Медосмотр', description: 'До начала тренировок.',
            nodeType: 'dao', nodeSubtype: 'simple', x: 380, y: 0, downstream: ['n2'] }],
    update: [], remove: [],
  });

  assert.equal(r.type, 'changes');
  assert.equal(r.operations.length, 1);
  const op = r.operations[0];
  assert.equal(op.op, 'add');
  assert.equal(op.title, 'Медосмотр');
  assert.equal(op.description, 'До начала тренировок.');
  assert.deepEqual(op.downstream, ['real-2']);
});

test('an update names a real node and only the fields it changes', () => {
  const r = changes({
    kind: 'changes', summary: 'Уточнил описание',
    add: [], remove: [],
    update: [{ target: 'n2', title: '', description: 'Подписанный оффер.', nodeType: '', nodeSubtype: '', requiredCompletions: 0 }],
  });

  const op = r.operations[0];
  assert.equal(op.target, 'real-2');
  assert.equal(op.description, 'Подписанный оффер.');
  assert.equal('title' in op, false, 'an empty string means leave it alone');
});

test('an update that changes nothing is not proposed at all', () => {
  const r = changes({
    kind: 'changes', summary: 'ничего',
    add: [], remove: [],
    update: [{ target: 'n2', title: '', description: '', nodeType: '', nodeSubtype: '', requiredCompletions: 0 }],
  });

  assert.equal(r.type, 'text', 'nothing to apply means nothing to confirm');
});

test('deleting a node that has children is refused', () => {
  // It would orphan the subtree, and the model cannot see the consequence.
  const r = changes({
    kind: 'changes', summary: 'Удаляю категорию',
    add: [], update: [], remove: [{ target: 'n3' }],
  });

  assert.equal(r.type, 'text');
  assert.match(r.message, /\p{L}/u);
});

test('deleting a leaf is allowed', () => {
  const r = changes({
    kind: 'changes', summary: 'Убираю лишнее',
    add: [], update: [], remove: [{ target: 'n2' }],
  });

  assert.equal(r.operations.length, 1);
  assert.equal(r.operations[0].op, 'delete');
  assert.equal(r.operations[0].target, 'real-2');
});

test('an operation aimed at a node that does not exist is dropped', () => {
  const r = changes({
    kind: 'changes', summary: 'x',
    add: [], update: [], remove: [{ target: 'n99' }, { target: 'n2' }],
  });

  assert.equal(r.operations.length, 1);
  assert.equal(r.operations[0].target, 'real-2');
});

test('an impossible kind on an added node is coerced, as in a plain plan', () => {
  const r = changes({
    kind: 'changes', summary: 'x',
    add: [{ alias: 'a1', title: 'T', description: '', nodeType: 'repeatable', nodeSubtype: 'category', x: 0, y: 0, downstream: [] }],
    update: [], remove: [],
  });

  assert.equal(r.operations[0].nodeType, 'dao');
  assert.equal(r.operations[0].nodeSubtype, 'simple');
});

test('a runaway batch is refused rather than applied', () => {
  const r = changes({
    kind: 'changes', summary: 'всё сразу',
    add: Array.from({ length: MAX_OPERATIONS + 1 }, (_, i) => ({
      alias: `a${i}`, title: `T${i}`, description: '', nodeType: 'dao', nodeSubtype: 'simple', x: 0, y: 0, downstream: [],
    })),
    update: [], remove: [],
  });

  assert.equal(r.type, 'text');
  assert.match(r.message, /\p{L}/u);
});

test('the summary reaches the user alongside the operations', () => {
  const r = changes({
    kind: 'changes', summary: 'Добавил ветку про визу',
    add: [{ alias: 'a1', title: 'T', description: '', nodeType: 'dao', nodeSubtype: 'simple', x: 0, y: 0, downstream: [] }],
    update: [], remove: [],
  });

  assert.equal(r.summary, 'Добавил ветку про визу');
});

test('counts are reported so the user can see the shape of the change', () => {
  const r = changes({
    kind: 'changes', summary: 'x',
    add: [{ alias: 'a1', title: 'T', description: '', nodeType: 'dao', nodeSubtype: 'simple', x: 0, y: 0, downstream: [] }],
    update: [{ target: 'n1', title: 'Новое', description: '', nodeType: '', nodeSubtype: '', requiredCompletions: 0 }],
    remove: [{ target: 'n2' }],
  });

  assert.deepEqual(r.counts, { add: 1, update: 1, delete: 1 });
});
