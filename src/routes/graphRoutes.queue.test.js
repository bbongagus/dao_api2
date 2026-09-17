import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { setupGraphRoutes } from './graphRoutes.js';
import { createGraphQueue } from '../handlers/graphQueue.js';
// graphRoutes pulls in dailyCompletions, which imports the shared client — and
// src/redis.js connects as soon as it is imported. Without closing it here the
// socket keeps the test process alive for ever.
import redis from '../redis.js';

test.after(() => redis.disconnect());

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The whole-graph save with a queue in front of it. `getGraph` and `saveGraph`
 * record when they were called so the ordering can be asserted.
 */
function serve(t) {
  const order = [];
  const graphQueue = createGraphQueue();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = 'someone'; next(); });
  app.use('/api', setupGraphRoutes({
    getGraph: async () => { order.push('route read'); return { nodes: [], edges: [] }; },
    saveGraph: async () => { order.push('route wrote'); return true; },
    clients: new Map(),
    graphQueue,
  }));

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { order, graphQueue, url: `http://127.0.0.1:${server.address().port}` };
}

const save = (url) => fetch(`${url}/api/graphs/main`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ nodes: [{ id: 'a' }], edges: [] }),
});

test('a whole-graph save waits for the operation already running on that graph', async (t) => {
  const { order, graphQueue, url } = serve(t);

  // An operation is already mid-flight on this person's graph.
  const operation = graphQueue.enqueue('someone:main', async () => {
    order.push('operation start');
    await tick(80);
    order.push('operation end');
  });

  await tick(10);
  const response = await save(url);
  await operation;

  assert.equal(response.status, 200);
  // The save used to read while the operation was still working and then write
  // over whatever it had saved — the whole-graph body is not a merge.
  assert.deepEqual(order, ['operation start', 'operation end', 'route read', 'route wrote']);
});

test('two whole-graph saves of the same graph do not interleave', async (t) => {
  const { order, url } = serve(t);

  await Promise.all([save(url), save(url)]);

  assert.deepEqual(order, ['route read', 'route wrote', 'route read', 'route wrote']);
});
