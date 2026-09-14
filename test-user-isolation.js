#!/usr/bin/env node

/**
 * Regression test: WebSocket broadcasts must not cross user boundaries.
 *
 * Every user's default graph is called "main". The broadcast filters used to
 * match on graphId alone, so one user's operations - node titles included -
 * were pushed to every other connected user.
 *
 * Usage: node test-user-isolation.js [wsUrl]      (default ws://localhost:3001)
 */

import { WebSocket } from 'ws';

const WS_URL = process.argv[2] || 'ws://localhost:3001';
const USER_A = 'isolation-a-' + Date.now();
const USER_B = 'isolation-b-' + Date.now();

let failures = 0;
const check = (cond, msg) => {
  if (!cond) failures++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + msg);
};

const subscribe = (userId) => new Promise((resolve, reject) => {
  const ws = new WebSocket(WS_URL);
  ws.messages = [];
  ws.on('message', (raw) => ws.messages.push(JSON.parse(raw)));
  ws.on('error', reject);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', graphId: 'main', userId }));
    setTimeout(() => resolve(ws), 400);
  });
});

async function main() {
  console.log(`🧪 User isolation against ${WS_URL}\n`);

  const aTab1 = await subscribe(USER_A);
  const aTab2 = await subscribe(USER_A);
  const bTab1 = await subscribe(USER_B);

  aTab2.messages.length = 0;
  bTab1.messages.length = 0;

  aTab1.send(JSON.stringify({
    type: 'OPERATION',
    payload: {
      type: 'ADD_NODE',
      payload: {
        node: {
          id: 'isolation-probe-' + Date.now(),
          title: 'private node belonging to user A',
          nodeType: 'dao',
          nodeSubtype: 'simple',
          position: { x: 0, y: 0 },
          children: [],
          linkedNodeIds: {}
        },
        parentId: null
      }
    }
  }));

  await new Promise((r) => setTimeout(r, 900));

  const applied = (m) => m.type === 'OPERATION_APPLIED';
  check(aTab2.messages.some(applied), 'a second tab of the same user receives the update');
  check(!bTab1.messages.some(applied), 'a different user receives nothing');

  if (bTab1.messages.some(applied)) {
    console.log('\n  leaked payload:', JSON.stringify(bTab1.messages.find(applied), null, 2));
  }

  [aTab1, aTab2, bTab1].forEach((ws) => ws.close());
  console.log(failures ? `\n❌ ${failures} check(s) failed\n` : '\n✅ isolation holds\n');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ test error:', err.message);
  process.exit(1);
});
