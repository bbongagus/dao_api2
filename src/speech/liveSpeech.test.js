import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';

import { setupSpeechSocket, speechCost } from './liveSpeech.js';

/** Deepgram, stubbed: it opens on demand, records what it was sent. */
function fakeUpstream() {
  const up = new EventEmitter();
  up.readyState = WebSocket.CONNECTING;
  up.sent = [];
  up.send = (data) => up.sent.push(data);
  up.open = () => { up.readyState = WebSocket.OPEN; up.emit('open'); };
  up.say = (event) => up.emit('message', Buffer.from(JSON.stringify(event)));
  up.close = () => { up.readyState = WebSocket.CLOSED; up.emit('close'); };
  return up;
}

function serve(t, { allowed = true, key = 'dg', maxSeconds } = {}) {
  const calls = { recorded: [], upstreams: [], urls: [] };
  let clock = 0;
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  setupSpeechSocket({
    wss,
    verifyToken: async (token) => {
      if (token !== 'good') throw new Error('bad token');
      return { userId: 'someone' };
    },
    ledger: {
      check: async () => (allowed ? { allowed: true } : { allowed: false, scope: 'user' }),
      record: async (userId, dollars) => { calls.recorded.push({ userId, dollars }); },
    },
    deepgramKey: () => key,
    connect: ({ url }) => { const up = fakeUpstream(); calls.urls.push(url); calls.upstreams.push(up); return up; },
    now: () => clock,
    ...(maxSeconds ? { maxSeconds } : {}),
  });
  server.listen(0);
  t.after(() => { wss.clients.forEach((c) => c.terminate()); return new Promise((r) => server.close(r)); });
  const url = `ws://127.0.0.1:${server.address().port}`;
  return { calls, url, tick: (s) => { clock += s * 1000; } };
}

/** A client that collects every JSON message until the socket closes. */
async function connect(url) {
  const ws = new WebSocket(url);
  const got = [];
  const waiters = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    got.push(JSON.parse(data.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise((r) => ws.on('close', r));
  await new Promise((r) => ws.on('open', r));
  const until = async (pred) => { while (!got.some(pred)) await new Promise((r) => waiters.push(r)); };
  return { ws, got, closed, until, json: (m) => ws.send(JSON.stringify(m)) };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test('audio is streamed through, words come back as they are heard, and the minutes are charged', async (t) => {
  const { calls, url, tick } = serve(t);
  const c = await connect(url);
  c.json({ type: 'START', token: 'good', sampleRate: 16000 });
  c.ws.send(Buffer.from([1, 2]));           // spoken before Deepgram answered
  await settle();
  assert.match(calls.urls[0], /sample_rate=16000/);
  assert.match(calls.urls[0], /interim_results=true/);

  const up = calls.upstreams[0];
  up.open();
  await c.until((m) => m.type === 'READY');
  c.ws.send(Buffer.from([3, 4]));
  await settle();
  assert.deepEqual(up.sent.map((b) => [...b]), [[1, 2], [3, 4]]);

  up.say({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'привет' }] } });
  up.say({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'привет мир' }] } });
  await c.until((m) => m.isFinal);
  assert.deepEqual(c.got.filter((m) => m.type === 'TRANSCRIPT'), [
    { type: 'TRANSCRIPT', text: 'привет', isFinal: false },
    { type: 'TRANSCRIPT', text: 'привет мир', isFinal: true },
  ]);

  tick(20);
  c.json({ type: 'STOP' });
  await settle();
  assert.deepEqual(JSON.parse(up.sent.at(-1)), { type: 'CloseStream' });
  up.say({ type: 'Metadata', duration: 30 });
  up.close();
  await c.closed;
  assert.equal(c.got.at(-1).type, 'DONE');
  // Deepgram's 30 s beats the 20 s the clock saw: the larger one is billed.
  assert.deepEqual(calls.recorded, [{ userId: 'someone', dollars: speechCost(30) }]);
});

test('a bad token is refused and nothing goes upstream', async (t) => {
  const { calls, url } = serve(t);
  const c = await connect(url);
  c.json({ type: 'START', token: 'forged' });
  await c.closed;
  assert.deepEqual(c.got, [{ type: 'ERROR', reason: 'auth' }]);
  assert.equal(calls.upstreams.length, 0);
});

test('out of quota is refused before Deepgram is opened', async (t) => {
  const { calls, url } = serve(t, { allowed: false });
  const c = await connect(url);
  c.json({ type: 'START', token: 'good' });
  await c.closed;
  assert.deepEqual(c.got, [{ type: 'ERROR', reason: 'quota', scope: 'user' }]);
  assert.equal(calls.upstreams.length, 0);
});

test('without a key the microphone is unavailable', async (t) => {
  const { url } = serve(t, { key: '' });
  const c = await connect(url);
  c.json({ type: 'START', token: 'good' });
  await c.closed;
  assert.deepEqual(c.got, [{ type: 'ERROR', reason: 'unavailable' }]);
});

test('one stream per person: a second is refused while the first runs', async (t) => {
  const { calls, url } = serve(t);
  const first = await connect(url);
  first.json({ type: 'START', token: 'good' });
  await settle();
  calls.upstreams[0].open();
  const second = await connect(url);
  second.json({ type: 'START', token: 'good' });
  await second.closed;
  assert.deepEqual(second.got, [{ type: 'ERROR', reason: 'busy' }]);
  assert.equal(calls.upstreams.length, 1);
});

test('a closed tab stops the stream and still charges what ran', async (t) => {
  const { calls, url, tick } = serve(t);
  const c = await connect(url);
  c.json({ type: 'START', token: 'good' });
  await settle();
  const up = calls.upstreams[0];
  up.open();
  tick(12);
  c.ws.close();
  await settle();
  assert.deepEqual(JSON.parse(up.sent.at(-1)), { type: 'CloseStream' });
  up.close();
  await settle();
  assert.deepEqual(calls.recorded, [{ userId: 'someone', dollars: speechCost(12) }]);
});

test('a stream left running is closed at the limit', async (t) => {
  const { calls, url } = serve(t, { maxSeconds: 0.05 });
  const c = await connect(url);
  c.json({ type: 'START', token: 'good' });
  await settle();
  const up = calls.upstreams[0];
  up.open();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(JSON.parse(up.sent.at(-1)), { type: 'CloseStream' });
});
