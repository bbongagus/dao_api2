import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toClientResponse } from './graphPlan.js';

test('a clarifying question becomes a text response', () => {
  const result = toClientResponse({ kind: 'question', message: 'Which city?' });

  assert.equal(result.type, 'text');
  assert.equal(result.message, 'Which city?');
});

test('a plan becomes a plan response the frontend can apply', () => {
  const result = toClientResponse({
    kind: 'plan',
    nodes: [
      { nodeId: 'a', title: 'Goal', nodeType: 'fundamental', nodeSubtype: 'downstream', x: 0, y: 0, downstream: ['b'] },
      { nodeId: 'b', title: 'Task', nodeType: 'dao', nodeSubtype: 'simple', x: 200, y: 0, downstream: [] },
    ],
  });

  assert.equal(result.type, 'plan');
  assert.deepEqual(result.data.nodes[0].linkedNodeIds, { downstream: ['b'] });
  assert.equal(result.data.nodes[0].title, 'Goal');
  assert.equal(result.data.nodes[1].x, 200);
});

test('a downstream id that names no node in the plan is dropped', () => {
  // addPlanToGraph looks every target up in a map of nodes it just created,
  // so a dangling id would silently produce no edge. Drop it here instead.
  const result = toClientResponse({
    kind: 'plan',
    nodes: [
      { nodeId: 'a', title: 'Goal', nodeType: 'dao', nodeSubtype: 'simple', x: 0, y: 0, downstream: ['b', 'ghost'] },
      { nodeId: 'b', title: 'Task', nodeType: 'dao', nodeSubtype: 'simple', x: 200, y: 0, downstream: [] },
    ],
  });

  assert.deepEqual(result.data.nodes[0].linkedNodeIds, { downstream: ['b'] });
});

test('a node cannot point downstream at itself', () => {
  const result = toClientResponse({
    kind: 'plan',
    nodes: [
      { nodeId: 'a', title: 'Goal', nodeType: 'dao', nodeSubtype: 'simple', x: 0, y: 0, downstream: ['a'] },
    ],
  });

  assert.deepEqual(result.data.nodes[0].linkedNodeIds, { downstream: [] });
});

test('an empty plan is reported as a question, not an empty graph', () => {
  const result = toClientResponse({ kind: 'plan', nodes: [] });

  assert.equal(result.type, 'text');
});

test('an impossible type/subtype pair is coerced to a plain task', () => {
  // The Anthropic JSON-schema subset does not enforce enums - zodOutputFormat
  // folds them into the description - so the model can return a combination
  // that MST would reject on the client. Coerce rather than crash the editor.
  const result = toClientResponse({
    kind: 'plan',
    nodes: [
      { nodeId: 'a', title: 'Practise', nodeType: 'repeatable', nodeSubtype: 'category', x: 0, y: 0, downstream: [] },
    ],
  });

  assert.equal(result.data.nodes[0].nodeType, 'dao');
  assert.equal(result.data.nodes[0].nodeSubtype, 'simple');
  assert.equal(result.data.nodes[0].title, 'Practise');
});

test('an unknown node type is coerced to a plain task', () => {
  const result = toClientResponse({
    kind: 'plan',
    nodes: [
      { nodeId: 'a', title: 'Thing', nodeType: 'sideways', nodeSubtype: 'simple', x: 0, y: 0, downstream: [] },
    ],
  });

  assert.equal(result.data.nodes[0].nodeType, 'dao');
  assert.equal(result.data.nodes[0].nodeSubtype, 'simple');
});

test('a valid pair is left alone', () => {
  const result = toClientResponse({
    kind: 'plan',
    nodes: [
      { nodeId: 'a', title: 'Daily run', nodeType: 'repeatable', nodeSubtype: 'infinity', x: 0, y: 0, downstream: [] },
    ],
  });

  assert.equal(result.data.nodes[0].nodeType, 'repeatable');
  assert.equal(result.data.nodes[0].nodeSubtype, 'infinity');
});

test('a non-numeric position falls back to zero', () => {
  const result = toClientResponse({
    kind: 'plan',
    nodes: [
      { nodeId: 'a', title: 'Thing', nodeType: 'dao', nodeSubtype: 'simple', x: 'left', y: null, downstream: [] },
    ],
  });

  assert.equal(result.data.nodes[0].x, 0);
  assert.equal(result.data.nodes[0].y, 0);
});

// --- formatMessagesForAPI ---

test('chat history maps onto Anthropic roles', async () => {
  const { formatMessagesForAPI } = await import('../ai-planning.js');

  const out = formatMessagesForAPI([
    { sender: 'user', text: 'Help me move to New York' },
    { sender: 'ai', text: 'When do you want to move?' },
    { sender: 'user', text: 'In the spring' },
  ]);

  assert.deepEqual(out, [
    { role: 'user', content: 'Help me move to New York' },
    { role: 'assistant', content: 'When do you want to move?' },
    { role: 'user', content: 'In the spring' },
  ]);
});

test('no system message is smuggled into the messages array', async () => {
  const { formatMessagesForAPI } = await import('../ai-planning.js');

  const out = formatMessagesForAPI([{ sender: 'user', text: 'hi' }]);

  assert.equal(out.some((m) => m.role === 'system'), false);
});

test('leading assistant turns are dropped - the API needs a user turn first', async () => {
  const { formatMessagesForAPI } = await import('../ai-planning.js');

  const out = formatMessagesForAPI([
    { sender: 'ai', text: 'Hello! What are we planning?' },
    { sender: 'user', text: 'A move' },
  ]);

  assert.equal(out[0].role, 'user');
  assert.equal(out.length, 1);
});

test('empty messages produce an empty array rather than a malformed request', async () => {
  const { formatMessagesForAPI } = await import('../ai-planning.js');

  assert.deepEqual(formatMessagesForAPI([]), []);
});
