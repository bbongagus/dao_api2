import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeChatMessages } from './chat.js';

test('the graph is attached as its own turn, before the person speaks last', () => {
  const out = composeChatMessages(
    [{ role: 'user', content: 'добавь сбор документов' }],
    'Current graph (2 nodes):\nn1 [dao/simple] Оффер',
    null
  );

  assert.equal(out.length, 2);
  assert.match(out[0].content, /Current graph/);
  assert.equal(out[1].content, 'добавь сбор документов');
});

test('the whole conversation is kept, not just the last turn', () => {
  const out = composeChatMessages(
    [
      { role: 'user', content: 'построй план переезда' },
      { role: 'assistant', content: 'Куда именно?' },
      { role: 'user', content: 'в Нью-Йорк' },
    ],
    'Current graph (0 nodes):',
    null
  );

  assert.equal(out.length, 4);
  assert.equal(out.at(-1).content, 'в Нью-Йорк');
});

test('a source brief is attached as well, labelled', () => {
  const out = composeChatMessages(
    [{ role: 'user', content: 'разбей https://example.com' }],
    'Current graph (0 nodes):',
    'The page describes three stages.'
  );

  const joined = out.map((m) => m.content).join('\n');
  assert.match(joined, /three stages/);
  assert.equal(joined.includes('The page describes three stages.') , true);
  assert.notEqual(out.find((m) => m.content.includes('three stages')).content, 'The page describes three stages.');
});

test('the conversation still opens on a user turn', () => {
  const out = composeChatMessages(
    [{ role: 'assistant', content: 'привет' }, { role: 'user', content: 'план' }],
    'Current graph (0 nodes):',
    null
  );

  assert.equal(out[0].role, 'user');
});
