import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { setupAIRoutes } from './aiRoutes.js';

const tick = () => new Promise((r) => setImmediate(r));
function memoryJobs() {
  const data = new Map(), active = new Map(), latest = new Map(), stopped = new Set(), seen = new Set();
  const key = (u, id) => JSON.stringify([u, id]);
  return {
    async create(u, j) { if (data.has(key(u, j.id))) return 'existing'; if (active.has(u)) return 'busy'; await this.save(u, j); active.set(u, j.id); latest.set(key(u, j.graphId), j.id); return 'created'; },
    async get(u, id) { return structuredClone(data.get(key(u, id)) || null); },
    async latest(u, g) { return this.get(u, latest.get(key(u, g))); },
    async save(u, j) { data.set(key(u, j.id), structuredClone(j)); },
    async release(u, id) { if (active.get(u) === id) active.delete(u); },
    async cancel(u, id) { stopped.add(key(u, id)); },
    async cancelled(u, id) { return stopped.has(key(u, id)); },
    async acknowledge(u, id) { seen.add(key(u, id)); },
    async acknowledged(u, id) { return seen.has(key(u, id)); },
  };
}
async function serve(t, jobs = memoryJobs()) {
  let finish, started;
  const begun = new Promise((r) => { started = r; });
  const calls = { count: 0, recorded: [], signal: null };
  const app = express(); app.use(express.json());
  // Test-only identity source, production uses requireUser.
  app.use((req, res, next) => { req.userId = req.headers['x-test-user'] || 'alice'; next(); });
  app.use('/ai', setupAIRoutes({ jobs, getGraph: async () => ({ nodes: [], edges: [] }),
    ledger: { check: async () => ({ allowed: true }), record: async (...args) => calls.recorded.push(args) },
    provider: () => ({ configured: true, model: 'claude-sonnet-5' }),
    runAgent: async ({ signal, emit }) => {
      calls.count++; calls.signal = signal; emit({ type: 'status', text: 'Working' }); started();
      await new Promise((r) => { finish = r; signal.addEventListener('abort', r, { once: true }); });
      return { type: 'text', message: 'Ready', usage: { dollars: 0.01 } };
    },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => { finish?.(); server.closeAllConnections(); return new Promise((r) => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}/ai`;
  const request = (path, options = {}) => fetch(base + path, options);
  const start = (id = randomUUID()) => request('/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: id, chatId: 'chat', messages: [{ role: 'user', content: 'Plan' }] }) });
  return { request, start, calls, jobs, begun, finish: () => finish() };
}

test('a background reply survives closing the stream; retrying the same ID costs no second turn', async (t) => {
  const h = await serve(t), id = randomUUID();
  const response = await h.start(id); await h.begun; await response.body.cancel(); await tick();
  assert.equal(h.calls.signal.aborted, false);
  const again = await h.start(id); assert.equal(again.status, 202);
  assert.equal(h.calls.count, 1);
  h.finish();
  for (let i = 0; i < 20 && (await h.jobs.get('alice', id)).state !== 'finished'; i++) await tick();
  const { job } = await (await h.request(`/turns/${id}`)).json();
  assert.equal(job.result.message, 'Ready');
  assert.equal(h.calls.recorded.length, 1);
  assert.equal((await (await h.request('/turns/latest?graphId=main')).json()).job.id, id);
  await h.request(`/turns/${id}/ack`, { method: 'POST' });
  assert.equal((await (await h.request('/turns/latest?graphId=main')).json()).job, null);
});

test('only the owner can read or stop a background reply, and Stop cancels explicitly', async (t) => {
  const h = await serve(t), id = randomUUID(); const response = await h.start(id); await h.begun;
  const other = { headers: { 'x-test-user': 'bob' } };
  assert.equal((await h.request(`/turns/${id}`, other)).status, 404);
  assert.equal((await h.request(`/turns/${id}/stop`, { ...other, method: 'POST' })).status, 404);
  assert.equal(h.calls.signal.aborted, false);
  assert.equal((await h.start()).status, 409);
  assert.equal((await h.request(`/turns/${id}/stop`, { method: 'POST' })).status, 202);
  await response.text();
  assert.equal(h.calls.signal.aborted, true);
  assert.equal((await h.jobs.get('alice', id)).result.type, 'cancelled');
});

test('after a vanished worker, the saved request reports interruption instead of starting another paid turn', async (t) => {
  const jobs = memoryJobs(), id = randomUUID();
  await jobs.create('alice', { id, graphId: 'main', state: 'running', updatedAt: Date.now() - 60000 });
  const h = await serve(t, jobs);
  const { job } = await (await h.request('/turns/latest?graphId=main')).json();
  assert.equal(job.result.reason, 'interrupted');
  assert.equal(h.calls.count, 0);
});
