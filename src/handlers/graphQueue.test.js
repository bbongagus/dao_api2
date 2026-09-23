import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGraphQueue } from './graphQueue.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('operations on one graph run one after another, never side by side', async () => {
  const queue = createGraphQueue();
  const order = [];

  const slow = queue.enqueue('u:main', async () => { order.push('start slow'); await tick(); order.push('end slow'); });
  const fast = queue.enqueue('u:main', async () => { order.push('fast'); });

  await Promise.all([slow, fast]);

  assert.deepEqual(order, ['start slow', 'end slow', 'fast']);
});

test('different graphs do not wait for each other', async () => {
  const queue = createGraphQueue();
  const order = [];

  const a = queue.enqueue('a:main', async () => { await tick(); order.push('a'); });
  const b = queue.enqueue('b:main', async () => { order.push('b'); });

  await Promise.all([a, b]);

  assert.deepEqual(order, ['b', 'a'], 'b should not have waited for a');
});

test('the caller gets its own result, and its own error', async () => {
  const queue = createGraphQueue();

  assert.equal(await queue.enqueue('u:main', async () => 42), 42);
  await assert.rejects(queue.enqueue('u:main', async () => { throw new Error('nope'); }), /nope/);
});

test('one failed operation does not stop the ones behind it', async () => {
  const queue = createGraphQueue();
  const done = [];

  const failed = queue.enqueue('u:main', async () => { throw new Error('boom'); });
  const after = queue.enqueue('u:main', async () => { done.push('ran'); });

  await failed.catch(() => {});
  await after;

  assert.deepEqual(done, ['ran']);
});

test('draining waits for what is still running — a shutdown must not cut a save in half', async () => {
  const queue = createGraphQueue();
  let finished = false;

  queue.enqueue('u:main', async () => { await tick(); finished = true; });
  const result = await queue.drain();

  assert.equal(finished, true);
  assert.equal(result.timedOut, false);
});

test('draining gives up after its timeout rather than hanging the shutdown', async () => {
  const queue = createGraphQueue();
  // In a shutdown the server and Redis hold the process open; drain's own
  // timer is unref'd and must not. With nothing else alive, Node 22's runner
  // sees an empty event loop and cancels this test — and the next — before
  // the timer fires (Node 25 does not). This stands in for the server.
  const server = setInterval(() => {}, 1000);

  try {
    queue.enqueue('u:main', () => new Promise(() => {})).catch(() => {});
    const result = await queue.drain({ timeoutMs: 30 });

    assert.equal(result.timedOut, true);
  } finally {
    clearInterval(server);
  }
});

test('draining an idle queue returns at once', async () => {
  const result = await createGraphQueue().drain();

  assert.deepEqual(result, { pending: 0, timedOut: false });
});
