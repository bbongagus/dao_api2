import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { setupWebSocketHandler, UNAUTHORIZED } from './websocketHandler.js';

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

/** A server with one connected client. A token "token-for:<user>" proves <user>; anything else is refused. */
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
      if (typeof token === 'string' && token.startsWith('token-for:')) return { userId: token.slice('token-for:'.length) };
      throw new Error('refused');
    },
  });

  const ws = fakeSocket();
  wss.emit('connection', ws, {});

  const send = async (message) => {
    ws.emit('message', JSON.stringify(message));
    for (let i = 0; i < 5; i++) await tick();
  };

  return { ws, clients, reads, applied, send, client: () => [...clients.values()][0] };
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
