import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceBrief } from './sourceBrief.js';

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

// --- what reading a link may cost ---

test('a fetched page is capped, so one long page cannot become the whole bill', async () => {
  let sent = null;
  const client = {
    messages: {
      async create(params) {
        sent = params;
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'brief' }], usage: {} };
      },
    },
  };

  await buildSourceBrief(client, 'claude-sonnet-5', [{ role: 'user', content: 'see https://example.com/long' }]);

  const fetchTool = sent.tools.find((tool) => tool.name === 'web_fetch');
  assert.ok(fetchTool.max_content_tokens > 0, 'every fetch needs a ceiling');
  assert.ok(fetchTool.max_content_tokens <= 32_000, `${fetchTool.max_content_tokens} tokens per page is a lot of input`);
  assert.ok(fetchTool.max_uses <= 5);
});

test('every call the link reader makes is reported, including a paused turn resumed', async () => {
  const reported = [];
  let call = 0;
  const client = {
    messages: {
      async create() {
        call += 1;
        return call === 1
          ? { stop_reason: 'pause_turn', content: [], usage: { input_tokens: 100 } }
          : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'brief' }], usage: { input_tokens: 200 } };
      },
    },
  };

  await buildSourceBrief(client, 'claude-sonnet-5', [{ role: 'user', content: 'see https://example.com' }], {
    onUsage: (model, usage) => reported.push(usage.input_tokens),
  });

  assert.deepEqual(reported, [100, 200]);
});
