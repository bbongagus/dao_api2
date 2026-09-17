import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { setupWebSocketHandler, UNAUTHORIZED, TRY_AGAIN_LATER } from './websocketHandler.js';
import { VerifierUnavailableError } from '../auth/verifyToken.js';

/** A socket that remembers what the server sent it and how it was closed. */
function fakeSocket() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.sent = [];
  ws.closed = null;
  ws.send = (data) => ws.sent.push(JSON.parse(data));
  ws.close = (code, reason) => { ws.closed = { code, reason }; ws.readyState = 3; };
  return ws;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A server with one connected client. A token "token-for:<user>" proves <user>;
 * "slow-token-for:<user>" does too, 20 ms later, as a key set being fetched
 * would; "while-the-key-set-is-down" cannot be checked at all; anything else
 * is refused.
 */
function connect() {
  const wss = new EventEmitter();
  const clients = new Map();
  const reads = [];
  const applied = [];

  setupWebSocketHandler({
    wss,
    clients,
    getGraph: async (graphId, userId) => { reads.push({ graphId, userId }); return { nodes: [], edges: [], userId }; },
    saveGraph: async () => true,
    applyOperation: async (graphId, operation, userId) => { applied.push({ graphId, operation, userId }); return { nodes: [] }; },
    verifyToken: async (token) => {
      if (typeof token === 'string' && token.startsWith('slow-token-for:')) {
        await wait(20);
        return { userId: token.slice('slow-token-for:'.length) };
      }
      if (typeof token === 'string' && token.startsWith('token-for:')) return { userId: token.slice('token-for:'.length) };
      if (token === 'while-the-key-set-is-down') throw new VerifierUnavailableError('ERR_JWKS_TIMEOUT');
      throw new Error('refused');
    },
  });

  const ws = fakeSocket();
  wss.emit('connection', ws, {});

  // Hands a message over without waiting: a client can send several in one task.
  const emit = (message) => ws.emit('message', JSON.stringify(message));
  const send = async (message) => {
    emit(message);
    await settle();
  };

  return { ws, clients, reads, applied, emit, send, client: () => [...clients.values()][0] };
}

const types = (ws) => ws.sent.map((m) => m.type);
const edit = { type: 'OPERATION', payload: { type: 'UPDATE_NODE', payload: { id: 'n1', updates: { title: 'x' } } } };

test('SUBSCRIBE without a token is refused before anything is read', async () => {
  const { ws, reads, send } = connect();

  await send({ type: 'SUBSCRIBE', graphId: 'main', userId: 'alice' });

  assert.ok(types(ws).includes('AUTH_ERROR'));
  assert.ok(!types(ws).includes('GRAPH_STATE'));
  assert.equal(ws.closed?.code, UNAUTHORIZED);
  assert.equal(reads.length, 0);
});

test('a refused token is treated the same as none', async () => {
  const { ws, reads, send } = connect();

  await send({ type: 'SUBSCRIBE', graphId: 'main', token: 'forged' });

  assert.equal(ws.closed?.code, UNAUTHORIZED);
  assert.equal(reads.length, 0);
});

test('the user comes from the token, not from the message', async () => {
  const { ws, reads, send, client } = connect();

  await send({ type: 'SUBSCRIBE', graphId: 'main', userId: 'alice', token: 'token-for:bob' });

  assert.deepEqual(reads, [{ graphId: 'main', userId: 'bob' }]);
  assert.equal(ws.sent.find((m) => m.type === 'GRAPH_STATE').payload.userId, 'bob');
  assert.equal(client().userId, 'bob');
  assert.equal(ws.closed, null);
});

test('an OPERATION before any SUBSCRIBE is not applied', async () => {
  const { ws, applied, send } = connect();

  await send(edit);

  assert.equal(applied.length, 0);
  assert.ok(types(ws).includes('ERROR'));
});

test('an OPERATION after a refused SUBSCRIBE is not applied either', async () => {
  const { applied, send } = connect();

  await send({ type: 'SUBSCRIBE', graphId: 'main', token: 'forged' });
  await send(edit);

  assert.equal(applied.length, 0);
});

test('an OPERATION after SUBSCRIBE runs as the token\'s user', async () => {
  const { applied, send } = connect();

  await send({ type: 'SUBSCRIBE', graphId: 'main', token: 'token-for:bob' });
  await send(edit);

  assert.equal(applied.length, 1);
  assert.equal(applied[0].userId, 'bob');
});

test('a refused re-SUBSCRIBE drops the user the socket had', async () => {
  const { applied, send, client } = connect();

  await send({ type: 'SUBSCRIBE', graphId: 'main', token: 'token-for:bob' });
  await send({ type: 'SUBSCRIBE', graphId: 'main', token: 'forged' });
  await send(edit);

  assert.equal(client().userId, null);
  assert.equal(client().graphId, null);
  assert.equal(applied.length, 0);
});

test('an OPERATION sent right behind SUBSCRIBE waits for it', async () => {
  const { applied, emit } = connect();

  // In one task, the way the client flushes the edits it queued while the socket was opening.
  emit({ type: 'SUBSCRIBE', graphId: 'main', token: 'token-for:bob' });
  emit(edit);
  await settle();

  assert.equal(applied.length, 1);
  assert.equal(applied[0].userId, 'bob');
});

test('two SUBSCRIBEs take effect in the order sent', async () => {
  const { ws, emit, client } = connect();

  // The first token takes longer to check than the second.
  emit({ type: 'SUBSCRIBE', graphId: 'main', token: 'slow-token-for:alice' });
  emit({ type: 'SUBSCRIBE', graphId: 'main', token: 'token-for:bob' });
  await wait(60);

  assert.equal(client().userId, 'bob');
  assert.equal(ws.sent.filter((m) => m.type === 'GRAPH_STATE').at(-1).payload.userId, 'bob');
});

test('a token that cannot be checked right now is no refusal: the client is told to come back', async () => {
  const { ws, reads, send, client } = connect();

  await send({ type: 'SUBSCRIBE', graphId: 'main', token: 'while-the-key-set-is-down' });

  assert.ok(types(ws).includes('AUTH_UNAVAILABLE'));
  assert.ok(!types(ws).includes('AUTH_ERROR'));
  assert.equal(ws.closed?.code, 1013);
  assert.equal(TRY_AGAIN_LATER, 1013);
  assert.equal(reads.length, 0);
  assert.equal(client().userId, null);
});
