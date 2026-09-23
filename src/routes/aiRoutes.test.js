import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { setupAIRoutes } from './aiRoutes.js';

/**
 * The route with every collaborator stubbed. No Anthropic client is ever
 * constructed: `runAgent` is injected, so nothing here can cost money.
 */
function serve(t, { ledger, runAgent, journal, getGraph, provider } = {}) {
  const calls = { agent: 0, recorded: [], journalled: [], agentParams: null };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = 'someone'; next(); });
  app.use('/api/ai', setupAIRoutes({
    getGraph: getGraph ?? (async () => ({ nodes: [], edges: [] })),
    journal: journal ?? { record: (...args) => { calls.journalled.push(args); } },
    ledger: ledger === undefined ? allowingLedger(calls) : ledger,
    provider: provider ?? (() => aProvider()),
    runAgent: runAgent ?? (async (params) => {
      calls.agent += 1;
      calls.agentParams = params;
      return { type: 'text', message: 'ok', usage: { calls: 3, input: 1000, output: 50, dollars: 0.04 } };
    }),
  }));

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { calls, url: `http://127.0.0.1:${server.address().port}` };
}

const allowingLedger = (calls) => ({
  check: async () => ({ allowed: true, user: 2, global: 25, userQuota: 2, globalCap: 25, period: '2026-09' }),
  remaining: async () => ({ user: 2, global: 25, userQuota: 2, globalCap: 25, period: '2026-09' }),
  record: async (userId, dollars) => { calls.recorded.push({ userId, dollars }); },
});

const refusingLedger = (scope) => ({
  check: async () => ({ allowed: false, scope, user: 0, global: 0, userQuota: 2, globalCap: 25, period: '2026-09' }),
  remaining: async () => ({ user: 0, global: 0, userQuota: 2, globalCap: 25, period: '2026-09' }),
  record: async () => {},
});

const chat = (url, body = { messages: [{ role: 'user', content: 'привет' }] }) =>
  fetch(`${url}/api/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A configured provider on a priced model; nothing real is ever called. */
const aProvider = (overrides = {}) => ({
  model: 'claude-sonnet-5',
  name: 'Anthropic',
  configured: true,
  clientOptions: { apiKey: 'test-not-a-real-key', authToken: null, baseURL: undefined },
  extraBody: {},
  ...overrides,
});

test('a user out of quota is refused before the agent runs at all', async (t) => {
  const { calls, url } = serve(t, { ledger: refusingLedger('user') });

  const response = await chat(url);
  const body = await response.json();

  assert.equal(response.status, 402);
  assert.equal(body.error, 'quota_exhausted');
  assert.equal(body.scope, 'user');
  assert.equal(calls.agent, 0, 'no API call may be made for a refused turn');
});

test('the global cap refuses too, and says it was the cap', async (t) => {
  const { calls, url } = serve(t, { ledger: refusingLedger('global') });

  const body = await (await chat(url)).json();

  assert.equal(body.scope, 'global');
  assert.equal(calls.agent, 0);
});

test('a turn within quota runs, and what it cost is charged to the user', async (t) => {
  const { calls, url } = serve(t);

  const response = await chat(url);
  await response.text();

  assert.equal(response.status, 200);
  assert.equal(calls.agent, 1);
  assert.deepEqual(calls.recorded, [{ userId: 'someone', dollars: 0.04 }]);
});

test('the journal records what the turn cost, not just how long it took', async (t) => {
  const { calls, url } = serve(t);

  await (await chat(url)).text();

  const [, , entry] = calls.journalled[0];
  assert.equal(entry.kind, 'agent_turn');
  assert.equal(entry.usage.dollars, 0.04);
  assert.equal(entry.usage.input, 1000);
  assert.equal(entry.usage.calls, 3);
});

test('a ramp turn reaches the agent as one, and the journal says which it was', async (t) => {
  let given = null;
  const { calls, url } = serve(t, {
    runAgent: async (params) => { given = params; return { type: 'text', message: 'Что именно?', usage: { calls: 1, dollars: 0.01 } }; },
  });

  await (await chat(url, { messages: [{ role: 'user', content: 'хочу накачаться' }], mode: 'ramp' })).text();
  assert.equal(given.mode, 'ramp');
  assert.equal(calls.journalled[0][2].mode, 'ramp');

  await (await chat(url)).text();
  assert.equal(given.mode, undefined);
});

test('a turn that failed is still charged for the calls it made', async (t) => {
  const { calls, url } = serve(t, {
    runAgent: async () => ({ type: 'error', message: 'rate limited', usage: { calls: 1, dollars: 0.01 } }),
  });

  await (await chat(url)).text();

  assert.deepEqual(calls.recorded, [{ userId: 'someone', dollars: 0.01 }]);
});

test('with no ledger wired the route refuses — a miswiring must not hand out free spend', async (t) => {
  const { calls, url } = serve(t, { ledger: null });

  const response = await chat(url);

  assert.equal(response.status, 503);
  assert.equal(calls.agent, 0);
});

test('a model with no price is refused before the agent runs — it could never be charged', async (t) => {
  const { calls, url } = serve(t, { provider: () => aProvider({ model: 'someone/unpriced-model' }) });

  const response = await chat(url);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, 'model_not_priced');
  assert.equal(calls.agent, 0);
});

test('with no credentials for the provider the route refuses', async (t) => {
  const { calls, url } = serve(t, { provider: () => aProvider({ configured: false }) });

  assert.equal((await chat(url)).status, 503);
  assert.equal(calls.agent, 0);
});

test('the agent is handed the provider the route resolved', async (t) => {
  const provider = aProvider({ model: 'z-ai/glm-5.3-flash', extraBody: { provider: { only: ['deepinfra'] } } });
  const { calls, url } = serve(t, { provider: () => provider });

  await (await chat(url)).text();

  assert.equal(calls.agentParams.provider, provider);
  assert.equal(calls.journalled[0][2].model, 'z-ai/glm-5.3-flash');
});

test('the balance says who the goals are sent to', async (t) => {
  const { url } = serve(t, { provider: () => aProvider({ name: 'OpenRouter (deepinfra)' }) });

  const body = await (await fetch(`${url}/api/ai/balance`)).json();

  assert.equal(body.processor, 'OpenRouter (deepinfra)');
});

test('the balance endpoint says what is left', async (t) => {
  const { url } = serve(t);

  const body = await (await fetch(`${url}/api/ai/balance`)).json();

  assert.equal(body.user, 2);
  assert.equal(body.userQuota, 2);
  assert.equal(body.period, '2026-09');
});

test('a request with no messages is still a 400', async (t) => {
  const { url } = serve(t);

  const response = await chat(url, { messages: [] });

  assert.equal(response.status, 400);
});

test('a person who closes the tab stops the upstream calls they would still be billed for', async (t) => {
  let seenSignal = null;
  let abortedDuringTurn = false;

  const { url } = serve(t, {
    runAgent: async ({ signal }) => {
      seenSignal = signal;
      await new Promise((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', resolve, { once: true });
      });
      abortedDuringTurn = true;
      return { type: 'cancelled', usage: { calls: 1, dollars: 0.01 } };
    },
  });

  const leaving = new AbortController();
  const request = fetch(`${url}/api/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'привет' }] }),
    signal: leaving.signal,
  }).catch(() => {});

  // Give the handler a moment to reach the agent, then walk away.
  await new Promise((resolve) => setTimeout(resolve, 60));
  leaving.abort();
  await request;
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.ok(seenSignal, 'the agent must be given a signal at all');
  assert.equal(abortedDuringTurn, true, 'closing the response must abort the turn');
});

test('one turn at a time per person — a second is refused while the first runs', async (t) => {
  let release = () => {};
  const firstReached = new Promise((resolve) => { release = resolve; });
  let started = 0;

  // Always let the held turn go, even if an assertion below throws first:
  // otherwise the request hangs and the server never closes.
  t.after(() => release());

  const { url } = serve(t, {
    runAgent: async () => {
      started += 1;
      await firstReached;
      return { type: 'text', message: 'ok', usage: { calls: 1, dollars: 0.01 } };
    },
  });

  const first = chat(url).then((r) => r.text()).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 60));
  const second = await chat(url);
  const body = await second.json().catch(() => ({}));

  release();
  await first;

  assert.equal(second.status, 409);
  assert.equal(body.error, 'turn_in_progress');
  assert.equal(started, 1, 'the second turn must not reach the agent');
});

test('the next turn is allowed once the first has finished', async (t) => {
  const { url } = serve(t);

  await (await chat(url)).text();
  const second = await chat(url);

  assert.equal(second.status, 200);
  await second.text();
});
