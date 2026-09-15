/**
 * AI Routes - Extracted from simple-server.js
 * REST API endpoints for AI planning
 * Copied from simple-server.js lines 1044-1088
 */

import express from 'express';
import { DEFAULT_USER_ID } from '../services/graphService.js';
import { clipText } from '../services/journal.js';

// An inspect of a large branch runs long; the journal keeps enough to see
// what the agent was looking at.
const TOOL_RESULT_LIMIT = 4000;

const router = express.Router();

/**
 * Setup AI routes
 */
export function setupAIRoutes({ getGraph, journal = null }) {
  // AI Planning endpoint (dynamic import to avoid startup crash if API key missing)
  // Copied from simple-server.js lines 1044-1088
  router.post('/generate-plan', async (req, res) => {
    // DIAGNOSTIC: Log that this route is being hit
    console.log('🔍 [Server] /api/ai/generate-plan endpoint HIT');
    console.log('🔍 [Server] Request headers:', req.headers);
    console.log('🔍 [Server] Request body:', JSON.stringify(req.body).substring(0, 200));
    
    try {
      const { messages } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        console.error('🔍 [Server] Invalid request - missing messages array');
        return res.status(400).json({
          success: false,
          error: 'messages array is required'
        });
      }
      
      console.log('🤖 Generating AI plan for messages:', messages.length);
      
      // Dynamic import - only loads when endpoint is called
      const aiPlanningModule = await import('../ai-planning.js');
      const aiPlanning = aiPlanningModule.default;
      
      // Format and send to AI
      const formattedMessages = aiPlanning.formatMessagesForAPI(messages);
      const response = await aiPlanning.sendMessageToAI(formattedMessages);
      
      console.log('🔍 [Server] Sending successful response');
      res.json({
        success: true,
        response
      });
    } catch (error) {
      console.error('🔍 [Server] AI planning error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      console.error('❌ AI planning error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Graph chat - one streaming turn.
   *
   * Server-sent events over POST rather than EventSource: the request carries
   * the current graph, which is too big for a query string.
   *
   * Nothing here applies a change. The response is a proposal the editor
   * shows for confirmation.
   */
  router.post('/chat', async (req, res) => {
    const { messages, currentPath, graphId } = req.body || {};
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'messages array is required' });
    }

    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return res.status(503).json({ success: false, error: 'ANTHROPIC_API_KEY is not set on the server' });
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
    let aborted = false;
    res.on('close', () => { aborted = true; });

    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
    const startedAt = Date.now();
    const toolCalls = [];
    let result = null;

    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const { runGraphAgent } = await import('../ai/agent.js');

      const graph = await getGraph(graphId || 'main', userId);

      result = await runGraphAgent({
        client: new Anthropic(),
        model,
        nodes: graph?.nodes || [],
        edges: graph?.edges || [],
        currentPath: Array.isArray(currentPath) ? currentPath : [],
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

      // The turn as it happened, so "what did it just do?" has an answer
      // after the chat window is gone.
      const lastRequest = [...messages].reverse().find((m) => m.role === 'user');
      journal?.record(userId, graphId || 'main', {
        kind: 'agent_turn',
        request: lastRequest?.content ?? null,
        model,
        ms: Date.now() - startedAt,
        aborted,
        tools: toolCalls.map((call) => ({ ...call, result: clipText(call.result, TOOL_RESULT_LIMIT) })),
        result,
      });
    }
  });

  // DIAGNOSTIC: Log that the route has been registered
  console.log('🔍 [Server] AI Planning route registered at POST /api/ai/generate-plan');
  console.log('🔍 [Server] AI chat route registered at POST /api/ai/chat');

  return router;
}

export default router;
