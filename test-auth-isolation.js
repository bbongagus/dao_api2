#!/usr/bin/env node

/**
 * Regression test: nobody reaches a graph that is not their own.
 *
 * Runs against a real server and Redis. User A owns a graph with a line in it
 * nobody else may see. Every way of asking for it without A's token — no
 * token, garbage, a token signed by a key the server does not trust, A's own
 * token after it expired, B's token naming A in a header or a message — must
 * get none of it, over HTTP and over the WebSocket, and A's graph must be
 * byte-for-byte the same afterwards. Then A edits their graph for real, and
 * the change must reach A's other tab and never B.
 *
 * Tokens are signed with the local dev key, so the server must trust that key.
 * Every broadcast used to match on graphId alone, and every graph is "main":
 * this began as the test that caught one user's node titles reaching another.
 *
 * Usage: node --env-file=.env test-auth-isolation.js [baseUrl]   (default http://localhost:3013)
 * Redis: REDIS_URL, the one the server uses (default redis://localhost:6379).
 */

import Redis from 'ioredis';
import { WebSocket } from 'ws';
import { generateKeyPair, SignJWT } from 'jose';

import { devTokenFromEnv } from './src/auth/devToken.js';
import { DEV_ISSUER } from './src/auth/config.js';

const BASE = (process.argv[2] || 'http://localhost:3013').replace(/\/+$/, '');
const WS_URL = BASE.replace(/^http/, 'ws');
const stamp = Date.now();
const USER_A = `isolation-a-${stamp}`;
const USER_B = `isolation-b-${stamp}`;
const SECRET = `private line of user A ${stamp}`;
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) failures++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + msg);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One HTTP request, as whoever the token and headers say. */
async function request(method, path, { token, headers = {}, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, text: await response.text() };
}

/** Open a socket, send one message once it is open, and collect what comes back for half a second. */
function socket(message) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.messages = [];
    ws.closeCode = null;
    ws.on('message', (raw) => ws.messages.push(JSON.parse(raw)));
    ws.on('close', (code) => { ws.closeCode = code; });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify(message));
      setTimeout(() => resolve(ws), 500);
    });
  });
}

const subscribe = (fields) => socket({ type: 'SUBSCRIBE', graphId: 'main', ...fields });
const received = (ws, type) => ws.messages.some((m) => m.type === type);
const leaks = (ws) => JSON.stringify(ws.messages).includes(SECRET);

async function main() {
  console.log(`🧪 Authentication and isolation against ${BASE}\n`);

  // A's graph, written the way the server stores it.
  await redis.set(`user:${USER_A}:graph:main`, JSON.stringify({
    nodes: [{
      id: `secret-${stamp}`, title: SECRET, nodeType: 'dao', nodeSubtype: 'simple',
      isDone: false, position: { x: 0, y: 0 }, children: [], linkedNodeIds: {},
    }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, version: 1, userId: USER_A,
  }));
  const before = await redis.get(`user:${USER_A}:graph:main`);

  const tokenA = await devTokenFromEnv(USER_A);
  const tokenB = await devTokenFromEnv(USER_B);
  const expiredA = await devTokenFromEnv(USER_A, { expiresInSeconds: -60 });
  const stranger = await generateKeyPair('RS256');
  const now = Math.floor(Date.now() / 1000);
  const foreignA = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(USER_A).setIssuer(DEV_ISSUER).setAudience(process.env.AUTH_AUDIENCE)
    .setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(stranger.privateKey);

  const refused = [
    ['no token', undefined],
    ['garbage', 'not-a-token'],
    ['a token signed by a key the server does not trust', foreignA],
    ["A's own token, expired", expiredA],
  ];

  console.log('HTTP');
  const owner = await request('GET', '/api/graphs/main', { token: tokenA });
  check(owner.status === 200 && owner.text.includes(SECRET), 'A reads their own graph (the probe itself works)');

  for (const [name, token] of refused) {
    const read = await request('GET', '/api/graphs/main', { token, headers: { 'x-user-id': USER_A } });
    check(read.status === 401 && !read.text.includes(SECRET), `GET with ${name}: 401, nothing of A's`);
    const write = await request('POST', '/api/graphs/main', { token, headers: { 'x-user-id': USER_A }, body: { nodes: [] } });
    check(write.status === 401, `POST with ${name}: 401`);
  }

  const asB = await request('GET', '/api/graphs/main', { token: tokenB, headers: { 'x-user-id': USER_A } });
  check(asB.status === 200 && !asB.text.includes(SECRET), "B's token with x-user-id: A reads B's graph, not A's");

  const writeAsB = await request('POST', '/api/graphs/main', { token: tokenB, headers: { 'x-user-id': USER_A }, body: { nodes: [] } });
  check(writeAsB.status === 200, "B's token with x-user-id: A saves B's own graph");

  const chat = await request('POST', '/api/ai/chat', { body: { messages: [{ role: 'user', content: 'hi' }] } });
  check(chat.status === 401, 'the AI chat without a token: 401');

  console.log('\nWebSocket');
  for (const [name, token] of refused) {
    const ws = await subscribe({ userId: USER_A, ...(token ? { token } : {}) });
    check(
      received(ws, 'AUTH_ERROR') && ws.closeCode === 4401 && !received(ws, 'GRAPH_STATE') && !leaks(ws),
      `SUBSCRIBE with ${name}: AUTH_ERROR, closed with 4401, nothing of A's`
    );
    ws.close();
  }

  const bNamingA = await subscribe({ userId: USER_A, token: tokenB });
  check(received(bNamingA, 'GRAPH_STATE') && !leaks(bNamingA), "SUBSCRIBE with B's token and userId: A gets B's graph");
  bNamingA.close();

  const unsubscribed = await socket({
    type: 'OPERATION',
    payload: { type: 'UPDATE_NODE', payload: { id: `secret-${stamp}`, updates: { title: 'overwritten' } } },
  });
  check(received(unsubscribed, 'ERROR'), 'an OPERATION without a subscription is refused');
  unsubscribed.close();

  const after = await redis.get(`user:${USER_A}:graph:main`);
  check(after === before, "A's graph in Redis is byte-for-byte what it was");

  console.log('\nBroadcasts');
  const aTab1 = await subscribe({ token: tokenA });
  const aTab2 = await subscribe({ token: tokenA });
  const bTab = await subscribe({ token: tokenB });
  aTab2.messages.length = 0;
  bTab.messages.length = 0;

  aTab1.send(JSON.stringify({
    type: 'OPERATION',
    payload: {
      type: 'ADD_NODE',
      payload: {
        id: `probe-${stamp}`, title: `another private line of A ${stamp}`, nodeType: 'dao', nodeSubtype: 'simple',
        position: { x: 0, y: 0 }, children: [], linkedNodeIds: {}, parentId: null,
      },
    },
  }));
  await wait(900);

  check(received(aTab2, 'OPERATION_APPLIED'), "A's second tab receives A's change");
  check(
    !received(bTab, 'OPERATION_APPLIED') && !JSON.stringify(bTab.messages).includes(`probe-${stamp}`),
    'B receives nothing of it'
  );
  [aTab1, aTab2, bTab].forEach((ws) => ws.close());
}

try {
  await main();
} catch (error) {
  failures++;
  console.error('❌ test error:', error.message);
} finally {
  // Everything this run wrote: both users' graphs, history, journals, completions.
  const keys = [];
  for (const user of [USER_A, USER_B]) {
    for await (const batch of redis.scanStream({ match: `*${user}*`, count: 200 })) keys.push(...batch);
  }
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
}

console.log(failures ? `\n❌ ${failures} check(s) failed\n` : '\n✅ authentication and isolation hold\n');
process.exit(failures ? 1 : 0);
