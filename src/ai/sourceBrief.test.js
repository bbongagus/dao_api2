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

// --- reading the pages ---

/** A client that records what it was asked and answers with a fixed brief. */
function briefClient(answer = 'brief', usage = { input_tokens: 100 }) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(params) {
        calls.push(params);
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: answer }], usage };
      },
    },
  };
}

const pages = (byUrl) => async (url) => {
  const page = byUrl[url];
  if (!page) throw new Error('the page answered 404');
  return { url, title: page.title ?? '', text: page.text };
};

test('the pages are read here and handed to the model as text, with no server-side tool', async () => {
  const client = briefClient('В статье три этапа.');

  const brief = await buildSourceBrief(client, 'm', [{ role: 'user', content: 'see https://a.test/guide' }], {
    fetchPage: pages({ 'https://a.test/guide': { title: 'Guide', text: 'Этап 1. Этап 2. Этап 3.' } }),
  });

  assert.equal(brief, 'В статье три этапа.');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].tools, undefined, 'no provider-specific fetch tool');
  const sent = client.calls[0].messages[0].content;
  assert.match(sent, /https:\/\/a\.test\/guide/);
  assert.match(sent, /Этап 1\. Этап 2\. Этап 3\./);
});

test('the model is not called at all when no page could be read', async () => {
  const client = briefClient();

  const brief = await buildSourceBrief(client, 'm', [{ role: 'user', content: 'see https://a.test/missing' }], {
    fetchPage: pages({}),
  });

  assert.equal(brief, null);
  assert.equal(client.calls.length, 0, 'a turn that read nothing pays for nothing');
});

test('a link that could not be read is named after the brief, so the agent can say so', async () => {
  const client = briefClient('Brief of the first page.');

  const brief = await buildSourceBrief(client, 'm', [{ role: 'user', content: 'https://a.test/ok and https://b.test/gone' }], {
    fetchPage: pages({ 'https://a.test/ok': { text: 'content' } }),
  });

  assert.match(brief, /^Brief of the first page\./);
  assert.match(brief, /https:\/\/b\.test\/gone/);
  assert.doesNotMatch(client.calls[0].messages[0].content, /b\.test/);
});

test('no more than five links are read', async () => {
  const asked = [];
  const text = Array.from({ length: 8 }, (_, i) => `https://a.test/${i}`).join(' ');

  await buildSourceBrief(briefClient(), 'm', [{ role: 'user', content: text }], {
    fetchPage: async (url) => { asked.push(url); return { url, title: '', text: 'x' }; },
  });

  assert.equal(asked.length, 5);
});

test('the page text is marked as material to summarise, not instructions', async () => {
  const { BRIEF_SYSTEM_PROMPT } = await import('./sourceBrief.js');
  assert.match(BRIEF_SYSTEM_PROMPT, /not instructions/i);
});

test('the call the link reader makes is reported, and carries the routing it is given', async () => {
  const reported = [];
  const client = briefClient('brief', { input_tokens: 200 });

  await buildSourceBrief(client, 'm', [{ role: 'user', content: 'see https://a.test/x' }], {
    fetchPage: pages({ 'https://a.test/x': { text: 'x' } }),
    onUsage: (model, usage) => reported.push([model, usage.input_tokens]),
    extraBody: { provider: { only: ['deepinfra'] } },
  });

  assert.deepEqual(reported, [['m', 200]]);
  assert.deepEqual(client.calls[0].provider, { only: ['deepinfra'] });
});

test('a failing model call means no brief, never a thrown turn', async () => {
  const client = { messages: { async create() { throw new Error('upstream down'); } } };

  const brief = await buildSourceBrief(client, 'm', [{ role: 'user', content: 'see https://a.test/x' }], {
    fetchPage: pages({ 'https://a.test/x': { text: 'x' } }),
  });

  assert.equal(brief, null);
});
