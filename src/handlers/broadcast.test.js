import { test } from 'node:test';
import assert from 'node:assert/strict';

import { broadcastToGraph } from './broadcast.js';

const OPEN = 1;
const CLOSED = 3;

function socket(readyState = OPEN) {
  const sent = [];
  return { readyState, send: (data) => sent.push(data), sent };
}

const clientsOf = (entries) => new Map(entries.map((entry, i) => [i + 1, entry]));

test('reaches only the open sockets of the same user on the same graph', () => {
  const mine = socket();
  const myOtherTab = socket();
  const otherUserSameName = socket();
  const myOtherGraph = socket();
  const closed = socket(CLOSED);
  const clients = clientsOf([
    { userId: 'alice', graphId: 'main', ws: mine },
    { userId: 'alice', graphId: 'main', ws: myOtherTab },
    { userId: 'bob', graphId: 'main', ws: otherUserSameName },
    { userId: 'alice', graphId: 'side', ws: myOtherGraph },
    { userId: 'alice', graphId: 'main', ws: closed },
  ]);

  const reached = broadcastToGraph(clients, { userId: 'alice', graphId: 'main' }, { type: 'OPERATION_APPLIED' });

  assert.equal(reached, 2);
  assert.equal(mine.sent.length, 1);
  assert.equal(myOtherTab.sent.length, 1);
  assert.equal(otherUserSameName.sent.length, 0);
  assert.equal(myOtherGraph.sent.length, 0);
  assert.equal(closed.sent.length, 0);
});

test('an object is sent as JSON, a string as it is', () => {
  const ws = socket();
  const clients = clientsOf([{ userId: 'alice', graphId: 'main', ws }]);

  broadcastToGraph(clients, { userId: 'alice', graphId: 'main' }, { type: 'PING' });
  broadcastToGraph(clients, { userId: 'alice', graphId: 'main' }, '{"type":"PONG"}');

  assert.deepEqual(ws.sent, ['{"type":"PING"}', '{"type":"PONG"}']);
});

test('a target without a user or a graph reaches nobody, not everybody unsubscribed', () => {
  const ws = socket();
  const clients = clientsOf([{ userId: null, graphId: null, ws }]);

  assert.equal(broadcastToGraph(clients, { userId: null, graphId: null }, { type: 'X' }), 0);
  assert.equal(ws.sent.length, 0);
});
