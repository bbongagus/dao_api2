/**
 * AI Routes
 *
 * The graph chat, mounted behind requireUser (server.js): the agent reads the
 * graph of the user the request's token proves.
 */

import express from 'express';
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
  getGraph, journal = null, ledger = null, runAgent = defaultRunAgent, provider: getProvider = resolveProvider,
}) {
  // Built per call, not once per module: a module-level router accumulated the
  // handlers of every setup and answered them all with the first one's
  // dependencies — invisible in production, where this runs once.
  const router = express.Router();

  // One turn at a time per person. Without it a handful of tabs, or a stuck
  // retry loop, run turns in parallel and spend a month's quota in a minute —
  // the check before a turn only sees what has already been charged.
  const inFlight = new Set();

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
    const { messages, currentPath, graphId, mode } = parsed.value;

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
    inFlight.add(userId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Proxies that buffer would defeat the point of streaming.
      'X-Accel-Buffering': 'no',
    });

    const emit = (event) => { res.write(`data: ${JSON.stringify(event)}\n\n`); };

    // Watch the response, not the request: `req` emits 'close' as soon as its
    // body has been read, which is immediately.
    //
    // The flag used only to suppress further writes, so a person closing the
    // tab left the agent running — up to sixteen upstream requests, every one
    // of them billed, for an answer nobody would ever see. The controller
    // stops them.
    const leaving = new AbortController();
    let aborted = false;
    res.on('close', () => { aborted = true; leaving.abort(); });

    const { model } = provider;
    const startedAt = Date.now();
    const toolCalls = [];
    let result = null;

    try {
      const graph = await getGraph(graphId, userId);

      result = await runAgent({
        provider,
        signal: leaving.signal,
        nodes: graph?.nodes || [],
        edges: graph?.edges || [],
        currentPath,
        messages,
        mode,
        emit: (event) => { if (!aborted) emit(event); },
        onToolCall: (call) => toolCalls.push(call),
      });

      if (!aborted) emit({ type: 'result', result });
    } catch (error) {
      logger.error('AI chat error:', error);
      result = { type: 'error', message: error.message || 'AI chat failed' };
      if (!aborted) emit(result);
    } finally {
      inFlight.delete(userId);
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

      // The turn as it happened, so "what did it just do?" has an answer
      // after the chat window is gone.
      const lastRequest = [...messages].reverse().find((m) => m.role === 'user');
      journal?.record(userId, graphId, {
        kind: 'agent_turn',
        request: lastRequest?.content ?? null,
        mode,
        model,
        ms: Date.now() - startedAt,
        aborted,
        usage: result?.usage ?? null,
        tools: toolCalls.map((call) => ({ ...call, result: clipText(call.result, TOOL_RESULT_LIMIT) })),
        result,
      });
    }
  });

  console.log('🔍 [Server] AI chat route registered at POST /api/ai/chat');

  return router;
}
