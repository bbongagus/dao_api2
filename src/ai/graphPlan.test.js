import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toClientResponse, PLAN_SYSTEM_PROMPT } from './graphPlan.js';

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

test('an empty plan is reported as text, not an empty graph', () => {
  const result = toClientResponse({ kind: 'plan', nodes: [] });

  assert.equal(result.type, 'text');
});

test('a plan with no nodes never surfaces the leftover message field', () => {
  // Seen live: the model answered kind "plan" with an empty node list and a
  // single comma left in message, which reached the chat verbatim. The
  // message field only carries meaning when the answer IS a question.
  const result = toClientResponse({ kind: 'plan', message: ',', nodes: [] });

  assert.equal(result.type, 'text');
  assert.notEqual(result.message, ',');
  assert.ok(result.message.length > 20, 'the reader gets a real sentence');
});

test('a question whose message is punctuation falls back to something readable', () => {
  const result = toClientResponse({ kind: 'question', message: ' , ', nodes: [] });

  assert.equal(result.type, 'text');
  assert.ok(/\p{L}/u.test(result.message), 'the message contains actual words');
});

test('a real question is passed through as written', () => {
  const result = toClientResponse({ kind: 'question', message: 'Which city?', nodes: [] });

  assert.equal(result.message, 'Which city?');
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

// --- flat plans only ---

test('withChildren is coerced away - a plan cannot nest', () => {
  // addPlanToGraph creates every node at the current level, so nothing in a
  // plan can own children. A node claiming to would just render oddly.
  const result = toClientResponse({
    kind: 'plan',
    nodes: [
      { nodeId: 'a', title: 'Visa', nodeType: 'dao', nodeSubtype: 'withChildren', x: 0, y: 0, downstream: [] },
    ],
  });

  assert.equal(result.data.nodes[0].nodeType, 'dao');
  assert.equal(result.data.nodes[0].nodeSubtype, 'simple');
});

// --- links in the prompt ---

test('a bare url is picked out of the message', async () => {
  const { extractUrls } = await import('./sourceBrief.js');

  assert.deepEqual(
    extractUrls('Разбей это на граф: https://example.com/guide'),
    ['https://example.com/guide']
  );
});

test('several urls are all picked out, in order, without duplicates', async () => {
  const { extractUrls } = await import('./sourceBrief.js');

  assert.deepEqual(
    extractUrls('see https://a.test/x and https://b.test/y and https://a.test/x again'),
    ['https://a.test/x', 'https://b.test/y']
  );
});

test('trailing punctuation is not part of the url', async () => {
  const { extractUrls } = await import('./sourceBrief.js');

  assert.deepEqual(extractUrls('read https://example.com/page.'), ['https://example.com/page']);
  assert.deepEqual(extractUrls('(https://example.com/page)'), ['https://example.com/page']);
});

test('a message with no url yields nothing', async () => {
  const { extractUrls } = await import('./sourceBrief.js');

  assert.deepEqual(extractUrls('just plan me a move to New York'), []);
});

test('only http(s) counts - not every word with a dot', async () => {
  const { extractUrls } = await import('./sourceBrief.js');

  assert.deepEqual(extractUrls('open index.html or ftp://x.test/f'), []);
});

// --- attaching the source brief ---

test('the brief is attached as its own user turn, after the conversation', async () => {
  const { withSourceBrief } = await import('./sourceBrief.js');

  const out = withSourceBrief(
    [{ role: 'user', content: 'plan https://example.com/guide' }],
    'The guide describes three stages.'
  );

  assert.equal(out.length, 2);
  assert.equal(out[0].content, 'plan https://example.com/guide');
  assert.equal(out[1].role, 'user');
  assert.match(out[1].content, /three stages/);
});

test('no brief leaves the conversation untouched', async () => {
  const { withSourceBrief } = await import('./sourceBrief.js');

  const messages = [{ role: 'user', content: 'plan a move' }];

  assert.deepEqual(withSourceBrief(messages, null), messages);
  assert.deepEqual(withSourceBrief(messages, '   '), messages);
});

test('the brief is labelled so it is not mistaken for the person talking', async () => {
  const { withSourceBrief } = await import('./sourceBrief.js');

  const out = withSourceBrief([{ role: 'user', content: 'x' }], 'Some source text');

  assert.notEqual(out[1].content, 'Some source text');
  assert.match(out[1].content, /Some source text/);
});

// --- the prompt teaches something the pipeline accepts ---
// Not a TDD cycle: a guard so an edit to the prompt cannot leave behind an
// example that our own mapping would have to correct.

test('the worked example in the system prompt survives the mapping untouched', () => {
  const match = PLAN_SYSTEM_PROMPT.match(/\{\s*"kind": "plan"[\s\S]*?\n\}/);
  assert.ok(match, 'the prompt should contain a worked example');

  const example = JSON.parse(match[0]);
  const result = toClientResponse(example);

  assert.equal(result.type, 'plan');
  assert.equal(result.data.nodes.length, example.nodes.length);

  example.nodes.forEach((node, i) => {
    const mapped = result.data.nodes[i];
    assert.equal(mapped.nodeType, node.nodeType, `${node.nodeId} kept its type`);
    assert.equal(mapped.nodeSubtype, node.nodeSubtype, `${node.nodeId} kept its subtype`);
    assert.deepEqual(
      mapped.linkedNodeIds.downstream,
      node.downstream,
      `${node.nodeId} kept all its links - none dangled`
    );
  });
});

test('the example obeys the spacing the prompt asks for', () => {
  const example = JSON.parse(PLAN_SYSTEM_PROMPT.match(/\{\s*"kind": "plan"[\s\S]*?\n\}/)[0]);

  // A node is 180x60; overlapping nodes in the example would teach overlap.
  for (const a of example.nodes) {
    for (const b of example.nodes) {
      if (a === b) continue;
      const overlaps = Math.abs(a.x - b.x) < 180 && Math.abs(a.y - b.y) < 60;
      assert.equal(overlaps, false, `${a.nodeId} and ${b.nodeId} overlap`);
    }
  }
});
