import { test } from 'node:test';
import assert from 'node:assert/strict';

import { removeKataAt } from './removeKataAt.js';

/**
 * A stand-in for the few ioredis calls removeKataAt makes, with WATCH as Redis
 * has it: a watched key written by anyone else before EXEC makes EXEC answer
 * null and run nothing. `meanwhile` is that someone else — it runs right
 * after the GET, the gap the guard exists for.
 */
function fakeRedis(store, { meanwhile } = {}) {
  const calls = [];
  let watched = null;
  let dirty = false;

  const client = {
    calls,
    write(key, value) {
      store.set(key, value);
      if (key === watched) dirty = true;
    },
    async watch(key) {
      calls.push(['watch', key]);
      watched = key;
      dirty = false;
      return 'OK';
    },
    async unwatch() {
      calls.push(['unwatch']);
      watched = null;
      return 'OK';
    },
    async get(key) {
      calls.push(['get', key]);
      const value = store.has(key) ? store.get(key) : null;
      meanwhile?.(client);
      return value;
    },
    multi() {
      const queued = [];
      const tx = {
        set(...args) {
          queued.push(args);
          return tx;
        },
        async exec() {
          calls.push(['exec', ...queued]);
          const aborted = dirty;
          watched = null;
          dirty = false;
          if (aborted) return null;
          for (const [key, value] of queued) store.set(key, value);
          return queued.map(() => [null, 'OK']);
        },
      };
      return tx;
    },
  };
  return client;
}

const KEY = 'user:someone:graph:main';

const withKata = {
  version: 3,
  nodes: [
    { id: 'task', title: 'Задача', nodeType: 'dao', nodeSubtype: 'simple', children: [] },
    { id: 'habit', title: 'Бег', nodeType: 'repeatable', nodeSubtype: 'infinity', children: [] },
  ],
  edges: [{ id: 'e1', source: 'task', target: 'habit' }],
};

const withoutKata = {
  version: 1,
  nodes: [{ id: 'task', title: 'Задача', nodeType: 'dao', nodeSubtype: 'simple', children: [] }],
  edges: [],
};

const storeOf = (graph) => new Map([[KEY, typeof graph === 'string' ? graph : JSON.stringify(graph)]]);

test('a dry run reads, reports and writes nothing', async () => {
  const store = storeOf(withKata);
  const redis = fakeRedis(store);

  const outcome = await removeKataAt(redis, KEY);

  assert.deepEqual(outcome, { outcome: 'would-change', removed: 1, edgesRemoved: 1 });
  assert.equal(store.get(KEY), JSON.stringify(withKata));
  assert.deepEqual(redis.calls.map(([name]) => name), ['get']);
});

test('--apply writes the cleaned graph in a transaction guarded by WATCH, keeping the TTL', async () => {
  const store = storeOf(withKata);
  const redis = fakeRedis(store);

  const outcome = await removeKataAt(redis, KEY, { apply: true });

  assert.deepEqual(outcome, { outcome: 'changed', removed: 1, edgesRemoved: 1 });
  assert.deepEqual(redis.calls.map(([name]) => name), ['watch', 'get', 'exec']);
  const [, [key, , keepTtl]] = redis.calls[2];
  assert.equal(key, KEY);
  assert.equal(keepTtl, 'KEEPTTL');

  const written = JSON.parse(store.get(KEY));
  assert.deepEqual(written.nodes.map((n) => n.id), ['task']);
  assert.deepEqual(written.edges, []);
  assert.equal(written.version, 4);
});

test('a graph that changed between the read and the write is left alone', async () => {
  const theirs = JSON.stringify({ ...withKata, version: 4, nodes: [...withKata.nodes, { id: 'new', title: 'Новая', nodeType: 'dao', nodeSubtype: 'simple', children: [] }] });
  const store = storeOf(withKata);
  const redis = fakeRedis(store, { meanwhile: (client) => client.write(KEY, theirs) });

  const outcome = await removeKataAt(redis, KEY, { apply: true });

  assert.deepEqual(outcome, { outcome: 'raced', removed: 0, edgesRemoved: 0 });
  assert.equal(store.get(KEY), theirs, 'the other write survives');
});

test('a graph with no Kata is not written, and its WATCH is released', async () => {
  const store = storeOf(withoutKata);
  const redis = fakeRedis(store);

  const outcome = await removeKataAt(redis, KEY, { apply: true });

  assert.deepEqual(outcome, { outcome: 'unchanged', removed: 0, edgesRemoved: 0 });
  assert.deepEqual(redis.calls.map(([name]) => name), ['watch', 'get', 'unwatch']);
  assert.equal(store.get(KEY), JSON.stringify(withoutKata));
});

test('an unparseable graph is reported, not written, and its WATCH is released', async () => {
  const store = storeOf('{not json');
  const redis = fakeRedis(store);

  const outcome = await removeKataAt(redis, KEY, { apply: true });

  assert.deepEqual(outcome, { outcome: 'unparseable', removed: 0, edgesRemoved: 0 });
  assert.deepEqual(redis.calls.map(([name]) => name), ['watch', 'get', 'unwatch']);
  assert.equal(store.get(KEY), '{not json');
});

test('a key gone since the scan is passed over', async () => {
  const redis = fakeRedis(new Map());

  const outcome = await removeKataAt(redis, KEY, { apply: true });

  assert.deepEqual(outcome, { outcome: 'unchanged', removed: 0, edgesRemoved: 0 });
  assert.deepEqual(redis.calls.map(([name]) => name), ['watch', 'get', 'unwatch']);
});

test('a SET refused inside the transaction is an error, not a success', async () => {
  const store = storeOf(withKata);
  const redis = fakeRedis(store);
  redis.multi = () => ({
    set() { return this; },
    async exec() { return [[new Error('ERR syntax error')]]; },
  });

  await assert.rejects(removeKataAt(redis, KEY, { apply: true }), /syntax error/);
});
