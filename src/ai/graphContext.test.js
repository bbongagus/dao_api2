import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildGraphContext, resolveAliases } from './graphContext.js';

const node = (id, title, extra = {}) => ({
  id, title, description: '', nodeType: 'dao', nodeSubtype: 'simple',
  linkedNodeIds: {}, children: [], ...extra,
});

test('nodes are given short aliases, not their uuids', () => {
  const { text, aliasToId } = buildGraphContext([
    node('3f2a1b7c-0000-4000-8000-000000000001', 'Получить оффер'),
    node('3f2a1b7c-0000-4000-8000-000000000002', 'Собрать документы'),
  ]);

  assert.deepEqual(Object.keys(aliasToId), ['n1', 'n2']);
  assert.match(text, /n1/);
  assert.equal(text.includes('3f2a1b7c'), false, 'no uuid should reach the model');
});

test('the context shows what the model needs to reason about a node', () => {
  const { text } = buildGraphContext([
    node('a', 'Виза', { nodeType: 'fundamental', nodeSubtype: 'downstream',
                        description: 'Право на въезд и работу.',
                        linkedNodeIds: { downstream: ['b'] } }),
    node('b', 'Получить оффер'),
  ]);

  assert.match(text, /Виза/);
  assert.match(text, /fundamental\/downstream/);
  assert.match(text, /Право на въезд/);
  assert.match(text, /n1 → n2/, 'links are shown by alias');
});

test('an empty graph says so rather than producing a blank block', () => {
  const { text, aliasToId } = buildGraphContext([]);

  assert.deepEqual(aliasToId, {});
  assert.match(text, /\p{L}/u);
});

test('nested children are included and addressable', () => {
  const { aliasToId } = buildGraphContext([
    node('parent', 'Категория', { nodeType: 'fundamental', nodeSubtype: 'category',
                                  children: [node('kid', 'Вложенная задача')] }),
  ]);

  assert.equal(Object.keys(aliasToId).length, 2);
  assert.equal(aliasToId.n2, 'kid');
});

test('a long description is truncated so one node cannot flood the context', () => {
  const { text } = buildGraphContext([node('a', 'T', { description: 'ы'.repeat(1000) })]);

  assert.ok(text.length < 600, `context was ${text.length} chars`);
});

// --- resolving the model's answer back onto real nodes ---

test('aliases in operations are replaced by real ids', () => {
  const ops = resolveAliases(
    [{ op: 'update', target: 'n2', title: 'Новый заголовок' }],
    { n1: 'real-1', n2: 'real-2' }
  );

  assert.equal(ops[0].target, 'real-2');
});

test('an operation naming an alias that does not exist is dropped', () => {
  // The model can invent an id; it must not reach the editor.
  const ops = resolveAliases(
    [{ op: 'delete', target: 'n9' }, { op: 'delete', target: 'n1' }],
    { n1: 'real-1' }
  );

  assert.equal(ops.length, 1);
  assert.equal(ops[0].target, 'real-1');
});

test('an added node keeps its own alias - it has no real id yet', () => {
  const ops = resolveAliases(
    [{ op: 'add', alias: 'new1', title: 'Задача', downstream: ['n1'] }],
    { n1: 'real-1' }
  );

  assert.equal(ops[0].alias, 'new1');
  assert.deepEqual(ops[0].downstream, ['real-1']);
});

test('a link between two new nodes survives by alias', () => {
  const ops = resolveAliases(
    [{ op: 'add', alias: 'new1', title: 'A', downstream: ['new2'] },
     { op: 'add', alias: 'new2', title: 'B', downstream: [] }],
    {}
  );

  assert.deepEqual(ops[0].downstream, ['new2'], 'a new node is addressed by its alias');
});
