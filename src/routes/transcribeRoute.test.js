import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { setupAIRoutes } from './aiRoutes.js';
import { transcriptionCost } from '../ai/transcribe.js';

/** Deepgram is stubbed: nothing here sends audio anywhere or costs money. */
function serve(t, { key = 'dg-key', allowed = true, transcribe } = {}) {
  const calls = { recorded: [], sent: [] };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = 'someone'; next(); });
  app.use('/api/ai', setupAIRoutes({
    getGraph: async () => ({ nodes: [], edges: [] }),
    ledger: {
      check: async () => (allowed ? { allowed: true } : { allowed: false, scope: 'user' }),
      record: async (userId, dollars) => { calls.recorded.push({ userId, dollars }); },
    },
    deepgramKey: () => key,
    transcribe: transcribe ?? (async (params) => { calls.sent.push(params); return { text: 'привет мир', seconds: 30 }; }),
  }));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { calls, url: `http://127.0.0.1:${server.address().port}/api/ai/transcribe` };
}

const post = (url, body = Buffer.from('audio')) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body });

test('a clip comes back as text, and its minutes are charged to the person', async (t) => {
  const { calls, url } = serve(t);
  const res = await post(url);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: 'привет мир', seconds: 30 });
  assert.equal(calls.sent[0].contentType, 'audio/webm');
  assert.equal(calls.sent[0].apiKey, 'dg-key');
  assert.deepEqual(calls.recorded, [{ userId: 'someone', dollars: transcriptionCost(30) }]);
});

test('out of quota is refused before any audio leaves', async (t) => {
  const { calls, url } = serve(t, { allowed: false });
  assert.equal((await post(url)).status, 402);
  assert.equal(calls.sent.length, 0);
});

test('without a key the route says voice is unavailable', async (t) => {
  const { url } = serve(t, { key: '' });
  assert.equal((await post(url)).status, 503);
});

test('an empty body is refused', async (t) => {
  const { calls, url } = serve(t);
  assert.equal((await post(url, Buffer.alloc(0))).status, 400);
  assert.equal(calls.sent.length, 0);
});

test('a Deepgram failure is a 502 and charges nothing', async (t) => {
  const { calls, url } = serve(t, { transcribe: async () => { throw new Error('boom'); } });
  assert.equal((await post(url)).status, 502);
  assert.equal(calls.recorded.length, 0);
});
