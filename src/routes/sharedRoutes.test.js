import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { setupSharedRoutes, setupSharedReadRoutes, sharedKey, publishedCopy } from './sharedRoutes.js';
import { createRequireUser } from '../auth/requireUser.js';
import { createGraphQueue } from '../handlers/graphQueue.js';

/** Just what the routes use of a Redis client. */
function fakeRedis() {
  const store = new Map();
  const hashes = new Map();
  const hash = (key) => { if (!hashes.has(key)) hashes.set(key, new Map()); return hashes.get(key); };
  return {
    store,
    hashes,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => { store.set(key, value); return 'OK'; },
    del: async (...keys) => keys.filter((key) => store.delete(key)).length,
    hget: async (key, field) => hash(key).get(field) ?? null,
    hset: async (key, field, value) => { hash(key).set(field, value); return 1; },
    hdel: async (key, field) => (hash(key).delete(field) ? 1 : 0),
    hgetall: async (key) => Object.fromEntries(hash(key)),
  };
}

const task = (id, extra = {}) => ({
  id, title: id, description: '', nodeType: 'dao', nodeSubtype: 'simple', isDone: false,
  position: { x: 0, y: 0 }, children: [], linkedNodeIds: { upstream: [], downstream: [] }, ...extra,
});
const arrow = (source, target) => ({ id: `${source}-${target}`, source, target, type: 'floating', direction: 'downstream' });

// A plan with a fork, half done by its owner, beside a goal that is private.
const graphOf = () => ({
  nodes: [
    {
      ...task('plan', { title: 'Visa', description: 'How to get one.', nodeType: 'fundamental', nodeSubtype: 'category' }),
      children: [
        task('pre', { title: 'Prepare', isDone: true, doneAt: '2026-11-01T10:00:00.000Z', currentCompletions: 1 }),
        task('F', { title: 'Which way?', fork: true, choice: 'a', isDone: true, doneAt: '2026-11-02T10:00:00.000Z',
          forkOptions: [{ target: 'a', label: 'By land', hint: 'Cheaper' }] }),
        task('a', { title: 'Book a bus' }),
        task('b', { title: 'Book a flight', calculatedProgress: 0.4, secret: 'kept out' }),
        { ...task('list', { title: 'Papers', nodeSubtype: 'withChildren' }), children: [task('i1', { isDone: true }), task('i2')] },
      ],
    },
    { ...task('private', { title: 'Salary talk', nodeType: 'fundamental', nodeSubtype: 'category' }), children: [task('p1')] },
  ],
  edges: [arrow('pre', 'F'), arrow('F', 'a'), arrow('F', 'b'), arrow('a', 'list'), arrow('p1', 'pre'), arrow('plan', 'private')],
});

function serve(t, { redis = fakeRedis(), graphs = { 'ann:main': graphOf() }, graphQueue } = {}) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  const getGraph = async (graphId, userId) => structuredClone(graphs[`${userId}:${graphId}`] ?? { nodes: [], edges: [] });
  // The public page first, as in server.js: nothing asks who is reading.
  app.use('/shared', setupSharedReadRoutes({ redis }));
  // requireUser in production; here the user is whoever the header names.
  app.use('/api', (req, _res, next) => { req.userId = req.get('x-test-user') || 'ann'; next(); });
  app.use('/api', setupSharedRoutes({ redis, getGraph, graphQueue, now: () => new Date('2026-11-15T03:00:00.000Z') }));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, user = 'ann') => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed, headers: response.headers };
  };
  return { redis, call };
}

const flat = (nodes) => nodes.flatMap((node) => [node, ...flat(node.children || [])]);

test('publishing a plan gives a link name nobody could guess, and the page serves the plan', async (t) => {
  const { call } = serve(t);
  const published = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  assert.equal(published.status, 200);
  assert.match(published.body.slug, /^[A-Za-z0-9_-]{12,}$/);
  assert.equal(published.body.publishedAt, '2026-11-15T03:00:00.000Z');

  const page = await call('GET', `/shared/${published.body.slug}`, undefined, null);
  assert.equal(page.status, 200);
  assert.equal(page.body.title, 'Visa');
  assert.equal(page.body.nodes.length, 1);
  assert.deepEqual(flat(page.body.nodes).map((n) => n.id), ['plan', 'pre', 'F', 'a', 'b', 'list', 'i1', 'i2']);
});

test('the page is the plan as nobody has walked it: no tick, no time, no option taken', async (t) => {
  const { call } = serve(t);
  const { body } = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  const page = (await call('GET', `/shared/${body.slug}`, undefined, null)).body;

  for (const node of flat(page.nodes)) {
    assert.equal(node.isDone, false, node.id);
    assert.equal(node.doneAt, null, node.id);
    assert.equal(node.currentCompletions, 0, node.id);
  }
  const fork = flat(page.nodes).find((n) => n.id === 'F');
  assert.equal(fork.fork, true);
  assert.equal(fork.choice, null);
  assert.deepEqual(fork.forkOptions, [{ target: 'a', label: 'By land', hint: 'Cheaper' }]);
});

test('the page holds the plan and the arrows inside it, and nothing of the rest of the graph', async (t) => {
  const { call } = serve(t);
  const { body } = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  const page = (await call('GET', `/shared/${body.slug}`, undefined, null)).body;

  assert.deepEqual(page.edges.map((e) => e.id).sort(), ['F-a', 'F-b', 'a-list', 'pre-F']);
  const text = JSON.stringify(page);
  assert.ok(!text.includes('Salary talk'));
  assert.ok(!text.includes('private'));
  assert.ok(!text.includes('p1'));
});

test('the page says nothing of whose plan it is, or of fields the app does not draw', async (t) => {
  const { call } = serve(t);
  const { body } = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  const page = (await call('GET', `/shared/${body.slug}`, undefined, null)).body;

  assert.deepEqual(Object.keys(page).sort(), ['edges', 'nodes', 'publishedAt', 'slug', 'title']);
  const text = JSON.stringify(page);
  assert.ok(!text.includes('ann'));
  assert.ok(!text.includes('main'));
  assert.ok(!text.includes('kept out'));
  assert.ok(!text.includes('calculatedProgress'));
});

test('publishing the same plan again updates the same page', async (t) => {
  const graphs = { 'ann:main': graphOf() };
  const { call } = serve(t, { graphs });
  const first = (await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' })).body;
  graphs['ann:main'].nodes[0].title = 'Visa, second edition';
  const second = (await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' })).body;

  assert.equal(second.slug, first.slug);
  assert.equal((await call('GET', `/shared/${first.slug}`, undefined, null)).body.title, 'Visa, second edition');
});

test('a step inside a plan can be published on its own, with what is inside it', async (t) => {
  const { call } = serve(t);
  const { body } = await call('POST', '/api/graphs/main/shares', { nodeId: 'list' });
  const page = (await call('GET', `/shared/${body.slug}`, undefined, null)).body;
  assert.deepEqual(flat(page.nodes).map((n) => n.id), ['list', 'i1', 'i2']);
  assert.deepEqual(page.edges, []);
});

test('the owner sees what is published from a graph', async (t) => {
  const { call } = serve(t);
  const { body } = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  const listed = await call('GET', '/api/graphs/main/shares');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body, { shares: [{ nodeId: 'plan', slug: body.slug, title: 'Visa', publishedAt: '2026-11-15T03:00:00.000Z' }] });
  // Someone else's list is their own.
  assert.deepEqual((await call('GET', '/api/graphs/main/shares', undefined, 'bob')).body, { shares: [] });
});

test('taking a page down is the owner\'s alone, and then it is gone', async (t) => {
  const { call } = serve(t);
  const { body } = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });

  assert.equal((await call('DELETE', `/api/shares/${body.slug}`, undefined, 'bob')).status, 404);
  assert.equal((await call('GET', `/shared/${body.slug}`, undefined, null)).status, 200);

  assert.equal((await call('DELETE', `/api/shares/${body.slug}`)).status, 200);
  assert.equal((await call('GET', `/shared/${body.slug}`, undefined, null)).status, 404);
  assert.deepEqual((await call('GET', '/api/graphs/main/shares')).body, { shares: [] });
  // Published again, it gets a new address: the old link stays dead.
  const again = (await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' })).body;
  assert.notEqual(again.slug, body.slug);
});

test('a node that is not in the graph cannot be published, nor one named badly', async (t) => {
  const { call } = serve(t);
  assert.equal((await call('POST', '/api/graphs/main/shares', { nodeId: 'no-such-node' })).status, 404);
  assert.equal((await call('POST', '/api/graphs/main/shares', {})).status, 400);
  assert.equal((await call('POST', '/api/graphs/main/shares', { nodeId: 7 })).status, 400);
  // Another person's graph is not this one's to publish from.
  assert.equal((await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' }, 'bob')).status, 404);
});

test('a link nobody published answers 404, whatever its shape', async (t) => {
  const { call } = serve(t);
  assert.equal((await call('GET', '/shared/AAAAAAAAAAAA', undefined, null)).status, 404);
  assert.equal((await call('GET', '/shared/..%2F..%2Fuser:ann:graph:main', undefined, null)).status, 404);
  assert.equal((await call('GET', `/shared/${'x'.repeat(200)}`, undefined, null)).status, 404);
});

test('a slug never reads a key that is not a published page', async (t) => {
  const redis = fakeRedis();
  redis.store.set('user:ann:graph:main', JSON.stringify(graphOf()));
  redis.store.set(`${sharedKey('abc')}:owner`, JSON.stringify({ userId: 'ann' }));
  const { call } = serve(t, { redis });
  // The owner record sits beside the page; its name is not a slug.
  assert.equal((await call('GET', '/shared/abc:owner', undefined, null)).status, 404);
  assert.equal((await call('GET', '/shared/abc%3Aowner', undefined, null)).status, 404);
});

test('a plan too large to be a page is refused, with the reason', async (t) => {
  const big = graphOf();
  big.nodes[0].children = Array.from({ length: 600 }, (_, i) => task(`n${i}`));
  const { call } = serve(t, { graphs: { 'ann:main': big } });
  const refused = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  assert.equal(refused.status, 413);
  assert.match(refused.body.error, /500/);
});

test('the copy keeps what a reader needs and reads malformed fork fields as no fork', () => {
  const copy = publishedCopy({
    ...task('n', { title: 'Step', description: 'Why', requiredCompletions: 3, currentCompletions: 2, fork: 'yes', forkOptions: 'none' }),
    position: { x: 10, y: 20, z: 99 },
  });
  assert.deepEqual(copy, {
    id: 'n', title: 'Step', description: 'Why', nodeType: 'dao', nodeSubtype: 'simple',
    isDone: false, doneAt: null, currentCompletions: 0, requiredCompletions: 3,
    position: { x: 10, y: 20 }, children: [], fork: false, choice: null, forkOptions: [],
  });
});

// server.js mounts the page outside /api and everything else behind the
// token check. Mounted the same way here, with a check that refuses everyone.
test('the page asks for no token; publishing, listing and taking down do', async (t) => {
  const redis = fakeRedis();
  await redis.set(sharedKey('AAAAAAAAAAAA'), JSON.stringify({ slug: 'AAAAAAAAAAAA', title: 'Visa', publishedAt: 'then', nodes: [], edges: [] }));
  const quiet = { warn() {}, error() {} };
  const app = express();
  app.use('/api', createRequireUser(async () => { throw new Error('no such token'); }, quiet));
  app.use(express.json());
  app.use('/shared', setupSharedReadRoutes({ redis }));
  app.use('/api', setupSharedRoutes({ redis, getGraph: async () => graphOf() }));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = async (method, path) => (await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{"nodeId":"plan"}' : undefined,
  })).status;

  assert.equal(await status('GET', '/shared/AAAAAAAAAAAA'), 200);
  assert.equal(await status('POST', '/api/graphs/main/shares'), 401);
  assert.equal(await status('GET', '/api/graphs/main/shares'), 401);
  assert.equal(await status('DELETE', '/api/shares/AAAAAAAAAAAA'), 401);
  // And the page survives all three.
  assert.equal(await status('GET', '/shared/AAAAAAAAAAAA'), 200);
});

// ---- from the independent review of 2026-11-15 ----

const pageOf = async (call, nodeId = 'plan', graphId = 'main') => {
  const { body } = await call('POST', `/api/graphs/${graphId}/shares`, { nodeId });
  return (await call('GET', `/shared/${body.slug}`, undefined, null)).body;
};

test('a fork is served with the names of the options it has, and no other: not of a step since deleted, nor of one outside the plan', async (t) => {
  const graph = graphOf();
  const fork = graph.nodes[0].children.find((n) => n.id === 'F');
  fork.forkOptions = [
    { target: 'a', label: 'By land', hint: 'Cheaper' },
    { target: 'gone', label: 'Hitchhike (do not tell mum)', hint: 'private note' },
    { target: 'p1', label: 'Ask the boss', hint: 'the salary talk' },
    { target: 'list', label: 'No arrow leads here', hint: 'an option taken away' },
  ];
  const { call } = serve(t, { graphs: { 'ann:main': graph } });
  const page = await pageOf(call);

  assert.deepEqual(flat(page.nodes).find((n) => n.id === 'F').forkOptions, [{ target: 'a', label: 'By land', hint: 'Cheaper' }]);
  const text = JSON.stringify(page);
  for (const gone of ['Hitchhike', 'private note', 'Ask the boss', 'salary', 'No arrow leads here', 'taken away', 'p1']) {
    assert.ok(!text.includes(gone), gone);
  }
});

test('a task that is no longer marked as a fork is served with no option names at all', async (t) => {
  const graph = graphOf();
  const was = graph.nodes[0].children.find((n) => n.id === 'F');
  was.fork = false;
  const { call } = serve(t, { graphs: { 'ann:main': graph } });
  const node = flat((await pageOf(call)).nodes).find((n) => n.id === 'F');
  assert.equal(node.fork, false);
  assert.deepEqual(node.forkOptions, []);
});

test('an arrow is served as its ends, its kind and its direction, and nothing else stored on it', async (t) => {
  const graph = graphOf();
  graph.edges[0] = { ...graph.edges[0], label: 'only if the boss agrees', data: { note: 'private' } };
  const { call } = serve(t, { graphs: { 'ann:main': graph } });
  const page = await pageOf(call);
  for (const edge of page.edges) assert.deepEqual(Object.keys(edge).sort(), ['direction', 'id', 'source', 'target', 'type']);
  assert.ok(!JSON.stringify(page).includes('boss'));
});

test('a plan is weighed by its nodes, however many share an id', async (t) => {
  const big = graphOf();
  big.nodes[0].children = Array.from({ length: 600 }, () => task('same'));
  const { call } = serve(t, { graphs: { 'ann:main': big } });
  const refused = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  assert.equal(refused.status, 413);
  assert.match(refused.body.error, /500/);
});

test('a plan with more arrows than a plan has is refused', async (t) => {
  const tangled = graphOf();
  tangled.edges = Array.from({ length: 2500 }, (_, i) => ({ ...arrow('pre', 'F'), id: `e${i}` }));
  const { call } = serve(t, { graphs: { 'ann:main': tangled } });
  const refused = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  assert.equal(refused.status, 413);
  assert.match(refused.body.error, /arrows/);
});

test('a plan too heavy for a page is refused by its weight, whatever its node count', async (t) => {
  const heavy = graphOf();
  heavy.nodes[0].children[0].description = 'x'.repeat(600 * 1024);
  const { call, redis } = serve(t, { graphs: { 'ann:main': heavy } });
  const refused = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  assert.equal(refused.status, 413);
  assert.match(refused.body.error, /KB/);
  assert.equal([...redis.store.keys()].filter((k) => k.startsWith('shared:')).length, 0);
});

test('the page is served as it was stored, byte for byte, and for its reader only', async (t) => {
  const { call, redis } = serve(t);
  const { body } = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  const stored = redis.store.get(sharedKey(body.slug));
  const response = await call('GET', `/shared/${body.slug}`, undefined, null);
  assert.equal(JSON.stringify(response.body), stored);
  assert.match(response.headers.get('content-type'), /application\/json/);
  // A page taken down must not live on in a cache between its server and its reader.
  assert.match(response.headers.get('cache-control'), /private/);
  assert.doesNotMatch(response.headers.get('cache-control'), /public/);
});

test('an account has a bounded number of pages; publishing one again is always allowed', async (t) => {
  const many = { nodes: Array.from({ length: 52 }, (_, i) => ({ ...task(`g${i}`), children: [task(`s${i}`)] })), edges: [] };
  const { call } = serve(t, { graphs: { 'ann:main': many } });
  for (let i = 0; i < 50; i += 1) assert.equal((await call('POST', '/api/graphs/main/shares', { nodeId: `g${i}` })).status, 200);
  const refused = await call('POST', '/api/graphs/main/shares', { nodeId: 'g50' });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /50/);
  assert.equal((await call('POST', '/api/graphs/main/shares', { nodeId: 'g7' })).status, 200);
});

test('listing reads no page: its title and date are kept with its owner', async (t) => {
  const redis = fakeRedis();
  const { call } = serve(t, { redis });
  const { body } = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  const read = [];
  const get = redis.get;
  redis.get = async (key) => { read.push(key); return get(key); };
  const listed = await call('GET', '/api/graphs/main/shares');
  assert.deepEqual(listed.body.shares.map((s) => s.title), ['Visa']);
  assert.ok(!read.includes(sharedKey(body.slug)), 'the page itself was read');
});

test('the list is one graph\'s: a page made from another graph is not in it', async (t) => {
  const { call } = serve(t, { graphs: { 'ann:main': graphOf(), 'ann:work': graphOf() } });
  await call('POST', '/api/graphs/work/shares', { nodeId: 'plan' });
  assert.deepEqual((await call('GET', '/api/graphs/main/shares')).body, { shares: [] });
  assert.equal((await call('GET', '/api/graphs/work/shares')).body.shares.length, 1);
});

test('a graph and a node whose names run together do not share a page', async (t) => {
  const one = { nodes: [{ ...task('b:c', { title: 'First' }), children: [task('x')] }], edges: [] };
  const other = { nodes: [{ ...task('c', { title: 'Second' }), children: [task('y')] }], edges: [] };
  const { call } = serve(t, { graphs: { 'ann:a': one, 'ann:a:b': other } });
  const first = (await call('POST', '/api/graphs/a/shares', { nodeId: 'b:c' })).body;
  const second = (await call('POST', `/api/graphs/${encodeURIComponent('a:b')}/shares`, { nodeId: 'c' })).body;
  assert.notEqual(first.slug, second.slug);
  assert.equal((await call('GET', `/shared/${first.slug}`, undefined, null)).body.title, 'First');
});

test('the user is the token\'s: a name in the body or the address publishes nothing for anyone else', async (t) => {
  const { call, redis } = serve(t, { graphs: { 'ann:main': graphOf(), 'bob:main': { nodes: [], edges: [] } } });
  const asBob = await call('POST', '/api/graphs/main/shares?userId=ann', { nodeId: 'plan', userId: 'ann' }, 'bob');
  assert.equal(asBob.status, 404);
  assert.equal([...redis.store.keys()].length, 0);
});

test('taking down asks for a slug of the right shape before anything is read', async (t) => {
  const redis = fakeRedis();
  const { call } = serve(t, { redis });
  const read = [];
  const get = redis.get;
  redis.get = async (key) => { read.push(key); return get(key); };
  for (const odd of ['x', 'AAAAAAAAAAAA:owner', `${'A'.repeat(12)}%3Aowner`, 'A'.repeat(200)]) {
    assert.equal((await call('DELETE', `/api/shares/${odd}`)).status, 404);
  }
  assert.deepEqual(read, []);
});

test('two first publishes of one plan at once make one page', async (t) => {
  // A store slow enough that both would ask "is there a page yet?" before
  // either had written one — unless they take turns.
  const redis = fakeRedis();
  const hget = redis.hget;
  redis.hget = async (...args) => { await new Promise((resolve) => setTimeout(resolve, 30)); return hget(...args); };
  const { call } = serve(t, { redis, graphQueue: createGraphQueue() });
  const [one, two] = await Promise.all([
    call('POST', '/api/graphs/main/shares', { nodeId: 'plan' }),
    call('POST', '/api/graphs/main/shares', { nodeId: 'plan' }),
  ]);
  assert.equal(one.body.slug, two.body.slug);
  assert.equal((await call('GET', '/api/graphs/main/shares')).body.shares.length, 1);
});

test('publishing waits its turn in the graph\'s queue: the copy holds the edit that was under way', async (t) => {
  const graphs = { 'ann:main': graphOf() };
  const graphQueue = createGraphQueue();
  const { call } = serve(t, { graphs, graphQueue });
  // An operation in flight: it renames the plan, and takes a moment.
  const editing = graphQueue.enqueue('ann:main', async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    graphs['ann:main'].nodes[0].title = 'Visa, as just edited';
  });
  const published = call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  await editing;
  const { body } = await published;
  assert.equal((await call('GET', `/shared/${body.slug}`, undefined, null)).body.title, 'Visa, as just edited');
});

test('a page never stands without its owner: the owner is written first', async (t) => {
  const redis = fakeRedis();
  const set = redis.set;
  // The store goes away just before the page itself is written.
  redis.set = async (key, value) => {
    if (/^shared:[A-Za-z0-9_-]{12}$/.test(key)) throw new Error('store went away');
    return set(key, value);
  };
  const { call } = serve(t, { redis });
  assert.equal((await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' })).status, 500);
  const pages = [...redis.store.keys()].filter((k) => /^shared:[A-Za-z0-9_-]{12}$/.test(k));
  assert.deepEqual(pages, []);
  // What is left can be seen and taken down, or repaired by publishing again.
  redis.set = set;
  const listed = (await call('GET', '/api/graphs/main/shares')).body.shares;
  assert.equal(listed.length, 1);
  assert.equal((await call('DELETE', `/api/shares/${listed[0].slug}`)).status, 200);
  assert.deepEqual((await call('GET', '/api/graphs/main/shares')).body, { shares: [] });
});

test('taking a page down leaves another page of the same plan alone', async (t) => {
  // Two pages for one plan can only come from before publishes were queued;
  // the list points at one of them.
  const redis = fakeRedis();
  const { call } = serve(t, { redis });
  const { body } = await call('POST', '/api/graphs/main/shares', { nodeId: 'plan' });
  const twin = 'TWINTWINTWIN';
  await redis.set(sharedKey(twin), redis.store.get(sharedKey(body.slug)));
  await redis.set(`${sharedKey(twin)}:owner`, redis.store.get(`${sharedKey(body.slug)}:owner`));

  assert.equal((await call('DELETE', `/api/shares/${twin}`)).status, 200);
  assert.equal((await call('GET', `/shared/${twin}`, undefined, null)).status, 404);
  // The listed page is still listed, and still there.
  assert.equal((await call('GET', '/api/graphs/main/shares')).body.shares[0].slug, body.slug);
  assert.equal((await call('GET', `/shared/${body.slug}`, undefined, null)).status, 200);
});
