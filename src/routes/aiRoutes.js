/**
 * AI Routes
 *
 * The graph chat, mounted behind requireUser (server.js): the agent reads the
 * graph of the user the request's token proves.
 */

import express from 'express';
import { clipText } from '../services/journal.js';
import { parseChatRequest } from '../ai/chatRequest.js';

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
async function defaultRunAgent(params) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const { runGraphAgent } = await import('../ai/agent.js');
  return runGraphAgent({ client: new Anthropic(), ...params });
}

/**
 * @param {object} deps
 * @param {object|null} deps.ledger the spend ledger. **Required for /chat**: a
 *        missing one refuses the turn rather than running it unmetered, so a
 *        wiring mistake costs a 503 and not a month's budget.
 */
export function setupAIRoutes({ getGraph, journal = null, ledger = null, runAgent = defaultRunAgent }) {
  // Built per call, not once per module: a module-level router accumulated the
  // handlers of every setup and answered them all with the first one's
  // dependencies — invisible in production, where this runs once.
  const router = express.Router();

  /** What this person has left this month. */
  router.get('/balance', async (req, res) => {
    if (!ledger) return res.status(503).json({ error: 'unavailable' });
    res.json(await ledger.remaining(req.userId));
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
    const { messages, currentPath, graphId } = parsed.value;

    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return res.status(503).json({ success: false, error: 'ANTHROPIC_API_KEY is not set on the server' });
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

    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
    const startedAt = Date.now();
    const toolCalls = [];
    let result = null;

    try {
      const graph = await getGraph(graphId, userId);

      result = await runAgent({
        model,
        signal: leaving.signal,
        nodes: graph?.nodes || [],
        edges: graph?.edges || [],
        currentPath,
        messages,
        emit: (event) => { if (!aborted) emit(event); },
        onToolCall: (call) => toolCalls.push(call),
      });

      if (!aborted) emit({ type: 'result', result });
    } catch (error) {
      console.error('❌ AI chat error:', error);
      result = { type: 'error', message: error.message || 'AI chat failed' };
      if (!aborted) emit(result);
    } finally {
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
          console.error('Failed to record AI spend — the turn is unbilled:', error);
        }
      }

      // The turn as it happened, so "what did it just do?" has an answer
      // after the chat window is gone.
      const lastRequest = [...messages].reverse().find((m) => m.role === 'user');
      journal?.record(userId, graphId, {
        kind: 'agent_turn',
        request: lastRequest?.content ?? null,
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
