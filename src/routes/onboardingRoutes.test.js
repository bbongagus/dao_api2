import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { setupOnboardingRoutes, onboardingKey } from './onboardingRoutes.js';

/** Just what the routes use of a Redis client. */
function fakeRedis() {
  const store = new Map();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => { store.set(key, value); return 'OK'; },
  };
}

function serve(t, redis = fakeRedis()) {
  const app = express();
  app.use(express.json());
  // requireUser in production; here the user is whoever the header names.
  app.use((req, _res, next) => { req.userId = req.get('x-test-user') || 'someone'; next(); });
  app.use('/api', setupOnboardingRoutes({ redis }));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/onboarding`;
  const call = async (method, body, user = 'someone') => {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-user': user },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // express.json refuses a bare string before the route sees it, with HTML.
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed };
  };
  return { redis, call };
}

test('an account that has never been asked reads an empty record', async (t) => {
  const { call } = serve(t);
  const { status, body } = await call('GET');
  assert.equal(status, 200);
  assert.deepEqual(body, {});
});

test('a patch is merged into the record and the whole record comes back', async (t) => {
  const { call, redis } = serve(t);

  await call('PATCH', { intro: { status: 'in_progress', story: 'trip', sphereId: 'n1', roles: { s1: 'n2' }, step: 1 } });
  const { status, body } = await call('PATCH', { intro: { step: 3 } });

  assert.equal(status, 200);
  assert.equal(body.intro.status, 'in_progress');
  assert.equal(body.intro.story, 'trip');
  assert.equal(body.intro.sphereId, 'n1');
  assert.deepEqual(body.intro.roles, { s1: 'n2' });
  assert.equal(body.intro.step, 3);
  assert.match(body.intro.updatedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(JSON.parse(redis.store.get(onboardingKey('someone'))), body);
});

test('lessons are merged one by one', async (t) => {
  const { call } = serve(t);
  await call('PATCH', { lessons: { 'ai-chat': 'completed' } });
  const { body } = await call('PATCH', { lessons: { tidy: 'completed' } });
  assert.deepEqual(body.lessons, { 'ai-chat': 'completed', tidy: 'completed' });
});

test('one account never reads or writes another', async (t) => {
  const { call } = serve(t);
  await call('PATCH', { intro: { status: 'declined' } }, 'alice');

  assert.deepEqual((await call('GET', undefined, 'bob')).body, {});
  assert.equal((await call('GET', undefined, 'alice')).body.intro.status, 'declined');
});

test('anything outside the whitelist is refused and nothing is written', async (t) => {
  const { call, redis } = serve(t);
  const junk = [
    [],
    'x',
    { other: 1 },
    { intro: 'done' },
    { intro: { status: 'finished' } },
    { intro: { story: 'marathon' } },
    { intro: { step: 2.5 } },
    { intro: { step: 11 } },
    { intro: { step: -1 } },
    { intro: { sphereId: 'x'.repeat(65) } },
    { intro: { sphereId: 7 } },
    { intro: { roles: { s1: 'a', villain: 'b' } } },
    { intro: { roles: { s1: 5 } } },
    { intro: { userId: 'mallory' } },
    { lessons: { 'ai-chat': 'yes' } },
    { lessons: { ['x'.repeat(65)]: 'completed' } },
    { lessons: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`l${i}`, 'completed'])) },
  ];
  for (const body of junk) {
    const { status } = await call('PATCH', body);
    assert.equal(status, 400, `accepted ${JSON.stringify(body).slice(0, 80)}`);
  }
  assert.equal(redis.store.size, 0);
});

test('a record grown past 32 lessons through several patches is refused', async (t) => {
  const { call } = serve(t);
  const batch = (from) => Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`l${from + i}`, 'completed']));
  assert.equal((await call('PATCH', { lessons: batch(0) })).status, 200);
  assert.equal((await call('PATCH', { lessons: batch(16) })).status, 200);
  assert.equal((await call('PATCH', { lessons: { one: 'completed' } })).status, 400);
});

test('a stored record that is not JSON reads as empty rather than failing', async (t) => {
  const redis = fakeRedis();
  redis.store.set(onboardingKey('someone'), '{broken');
  const { call } = serve(t, redis);
  assert.deepEqual((await call('GET')).body, {});
});
