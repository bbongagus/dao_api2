/**
 * AI Routes
 *
 * The graph chat, mounted behind requireUser (server.js): the agent reads the
 * graph of the user the request's token proves.
 */

import express from 'express';
import { JOB_TIMEOUT_MS } from '../ai/chatJobStore.js';
import { clipText } from '../services/journal.js';
import { parseChatRequest } from '../ai/chatRequest.js';
import { isPriced } from '../ai/cost.js';
import { resolveProvider } from '../ai/provider.js';
import { logger } from '../utils/logger.js';

// An inspect of a large branch runs long; the journal keeps enough to see
// what the agent was looking at.
const TOOL_RESULT_LIMIT = 4000;

/**
 * Setup AI routes
 */
/**
 * The agent, loaded only when a turn actually runs — importing the SDK at boot
 * costs a slow start for a route most requests never touch. Injectable so the
 * route can be tested without an Anthropic client existing at all.
 */
async function defaultRunAgent({ provider, ...params }) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const { runGraphAgent } = await import('../ai/agent.js');
  return runGraphAgent({
    client: new Anthropic(provider.clientOptions),
    model: provider.model,
    extraBody: provider.extraBody,
    thinking: provider.thinking,
    ...params,
  });
}

/**
 * @param {object} deps
 * @param {object|null} deps.ledger the spend ledger. **Required for /chat**: a
 *        missing one refuses the turn rather than running it unmetered, so a
 *        wiring mistake costs a 503 and not a month's budget.
 */
/**
 * @param {() => object} [deps.provider] which model, through whom — read from
 *        the environment on every request by default (provider.js).
 */
export function setupAIRoutes({
  getGraph, journal = null, ledger = null, jobs = null, runAgent = defaultRunAgent, provider: getProvider = resolveProvider,
}) {
  // Built per call, not once per module: a module-level router accumulated the
  // handlers of every setup and answered them all with the first one's
  // dependencies — invisible in production, where this runs once.
  const router = express.Router();

  // One turn at a time per person. Without it a handful of tabs, or a stuck
  // retry loop, run turns in parallel and spend a month's quota in a minute —
  // the check before a turn only sees what has already been charged.
  const inFlight = new Set();
  const controllers = new Map();
  const jobKey = (user, id) => JSON.stringify([user, id]);
  const readJob = async (user, job) => {
    // A worker that vanished during a deploy must not look busy forever.
    if (job?.state === 'running' && Date.now() - job.updatedAt > 45000) {
      job = { ...job, state: 'finished', result: { type: 'error', reason: 'interrupted', message: 'The server restarted before the reply finished. Please try again. Your plan has not changed.' } };
      await jobs.save(user, job);
      await jobs.release(user, job.id);
    }
    return job;
  };
  router.get('/turns/latest', async (req, res) => {
    try {
      if (!jobs) return res.status(503).json({ error: 'unavailable' });
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(req.query.graphId || 'main')) return res.sendStatus(400);
      const job = await readJob(req.userId, await jobs.latest(req.userId, req.query.graphId || 'main'));
      res.set('Cache-Control', 'no-store').json({ job: job && !await jobs.acknowledged(req.userId, job.id) ? job : null });
    } catch { res.status(503).json({ error: 'unavailable' }); }
  });
  router.get('/turns/:id', async (req, res) => {
    try {
      const job = jobs && await readJob(req.userId, await jobs.get(req.userId, req.params.id));
      if (!job) return res.sendStatus(404);
      res.set('Cache-Control', 'no-store').json({ job });
    } catch { res.status(503).json({ error: 'unavailable' }); }
  });
  router.post('/turns/:id/stop', async (req, res) => {
    try {
      const job = jobs && await jobs.get(req.userId, req.params.id);
      if (!job) return res.sendStatus(404);
      if (job.state === 'running') {
        await jobs.cancel(req.userId, job.id);
        controllers.get(jobKey(req.userId, job.id))?.abort();
      }
      res.sendStatus(202);
    } catch { res.status(503).json({ error: 'unavailable' }); }
  });
  router.post('/turns/:id/ack', async (req, res) => {
    try {
      const job = jobs && await jobs.get(req.userId, req.params.id);
      if (!job) return res.sendStatus(404);
      await jobs.acknowledge(req.userId, job.id);
      res.sendStatus(204);
    } catch { res.status(503).json({ error: 'unavailable' }); }
  });

  /** What this person has left this month. */
  router.get('/balance', async (req, res) => {
    if (!ledger) return res.status(503).json({ error: 'unavailable' });
    // `processor` is who the person's goals are sent to; the chat panel says so.
    res.json({ ...(await ledger.remaining(req.userId)), processor: getProvider().name });
  });

  /**
   * Graph chat - one streaming turn.
   *
   * Server-sent events over POST rather than EventSource: EventSource can
   * send neither a body nor the Authorization header.
   *
   * Nothing here applies a change. The response is a proposal the editor
   * shows for confirmation.
   */
  router.post('/chat', async (req, res) => {
    const userId = req.userId;

    // Everything in the body is billed as input tokens and goes to the model
    // as written, so it is shaped and bounded here first — see chatRequest.js.
    const parsed = parseChatRequest(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error });
    }
    const { messages, currentPath, graphId, mode, applies, requestId, chatId, displayText } = parsed.value;
    let job = null;
    if (requestId) {
      if (!jobs) return res.status(503).json({ error: 'background_unavailable' });
      try {
        const existing = await readJob(userId, await jobs.get(userId, requestId));
        if (existing) return res.status(202).json({ job: existing });
      } catch { return res.status(503).json({ error: 'unavailable' }); }
    }

    const provider = getProvider();
    if (!provider.configured) {
      return res.status(503).json({ success: false, error: 'no AI provider key is set on the server' });
    }

    // Fail closed, like a missing ledger: a model with no price would run
    // every turn at $0 against the quota, which is no quota at all.
    if (!isPriced(provider.model)) {
      logger.error(`AI chat refused: model "${provider.model}" has no price in cost.js`);
      return res.status(503).json({ success: false, error: 'model_not_priced' });
    }

    // Fail closed: unmetered AI behind open sign-up is an open tap.
    if (!ledger) {
      console.error('AI chat refused: no spend ledger is wired');
      return res.status(503).json({ success: false, error: 'unavailable' });
    }

    // Before the stream opens, so a refusal is plain JSON the client can read,
    // and before any upstream call, so a refused turn costs nothing.
    const verdict = await ledger.check(userId);
    if (!verdict.allowed) {
      return res.status(402).json({
        error: 'quota_exhausted',
        scope: verdict.scope,
        user: verdict.user,
        global: verdict.global,
        userQuota: verdict.userQuota,
        globalCap: verdict.globalCap,
        period: verdict.period,
      });
    }

    if (inFlight.has(userId)) {
      return res.status(409).json({ error: 'turn_in_progress' });
    }
    if (requestId) {
      job = { id: requestId, chatId, graphId, mode, messages, displayText, state: 'running', status: 'Thinking…', updatedAt: Date.now(), createdAt: Date.now() };
      try {
        const outcome = await jobs.create(userId, job);
        if (outcome === 'existing') return res.status(202).json({ job: await jobs.get(userId, requestId) });
        if (outcome !== 'created') return res.status(409).json({ error: 'turn_in_progress' });
      } catch { return res.status(503).json({ error: 'unavailable' }); }
    }
    inFlight.add(userId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Proxies that buffer would defeat the point of streaming.
      'X-Accel-Buffering': 'no',
    });

    const emit = (event) => { res.write(`data: ${JSON.stringify(event)}\n\n`); };

    // Closing a modern client's stream detaches it; only Stop cancels its job.
    // Old clients retain their original cancellation semantics.
    const leaving = new AbortController();
    let aborted = false;
    let timedOut = false;
    let heartbeatBusy = false;
    res.on('close', () => { if (!res.writableEnded) { aborted = true; if (!job) leaving.abort(); } });
    if (job) controllers.set(jobKey(userId, job.id), leaving);
    const deadline = setTimeout(() => { timedOut = true; leaving.abort(); }, JOB_TIMEOUT_MS);
    const heartbeat = job && setInterval(async () => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      try {
        if (await jobs.cancelled(userId, job.id)) leaving.abort();
        job.updatedAt = Date.now();
        await jobs.save(userId, job);
      } catch { leaving.abort(); }
      finally { heartbeatBusy = false; }
    }, 10000);

    const { model } = provider;
    const startedAt = Date.now();
    const toolCalls = [];
    let result = null;

    try {
      const graph = await getGraph(graphId, userId);

      if (job && await jobs.cancelled(userId, job.id)) leaving.abort();
      result = leaving.signal.aborted ? { type: 'cancelled', message: 'Stopped.' } : await runAgent({
        provider,
        signal: leaving.signal,
        nodes: graph?.nodes || [],
        edges: graph?.edges || [],
        currentPath,
        messages,
        mode,
        // A tab from before moves would skip one and still apply a delete
        // staged after it, taking the moved nodes with the deleted parent.
        canMove: applies.includes('move'),
        emit: (event) => { if (job && event.type === 'status') job.status = event.text; if (!aborted) emit(event); },
        onToolCall: (call) => toolCalls.push(call),
      });

      if (leaving.signal.aborted) result = { ...result, type: timedOut ? 'error' : 'cancelled', reason: timedOut ? 'timeout' : 'cancelled', message: timedOut ? 'The reply took too long. Please try a smaller request. Your plan has not changed.' : 'Stopped. Your plan has not changed.' };
      if (job) {
        job.state = 'finished'; job.result = result; job.updatedAt = Date.now();
        await jobs.save(userId, job);
      }
      if (!aborted) emit({ type: 'result', result });
    } catch (error) {
      logger.error('AI chat error:', error);
      result = { usage: result?.usage, type: 'error', message: 'The assistant could not finish. Please try again. Your plan has not changed.' };
      if (job) { job.state = 'finished'; job.result = result; try { await jobs.save(userId, job); } catch { /* readJob reports a stale worker */ } }
      if (!aborted) emit(result);
    } finally {
      clearTimeout(deadline);
      if (heartbeat) clearInterval(heartbeat);
      if (job) controllers.delete(jobKey(userId, job.id));
      if (!aborted) res.end();

      // Charged after the fact: a turn's cost is only known once it has run,
      // so the turn that crosses the line overshoots by its own cost. Charged
      // even when the turn failed — the calls it made before failing were
      // billed by Anthropic all the same.
      const dollars = result?.usage?.dollars;
      if (dollars > 0) {
        try {
          await ledger.record(userId, dollars);
        } catch (error) {
          logger.error('Failed to record AI spend — the turn is unbilled:', error);
        }
      }

      if (job) { try { await jobs.release(userId, job.id); } catch { /* lease expires */ } }
      inFlight.delete(userId);

      // The turn as it happened, so "what did it just do?" has an answer
      // after the chat window is gone.
      const lastRequest = [...messages].reverse().find((m) => m.role === 'user');
      journal?.record(userId, graphId, {
        kind: 'agent_turn',
        request: lastRequest?.content ?? null,
        mode,
        model,
        ms: Date.now() - startedAt,
        aborted: leaving.signal.aborted,
        disconnected: aborted,
        usage: result?.usage ?? null,
        tools: toolCalls.map((call) => ({ ...call, result: clipText(call.result, TOOL_RESULT_LIMIT) })),
        result,
      });
    }
  });

  console.log('🔍 [Server] AI chat route registered at POST /api/ai/chat');

  return router;
}
