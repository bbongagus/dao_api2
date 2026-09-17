/**
 * Simple Optimistic UI Server - Refactored Version
 * Main entry point - coordinates all modules
 *
 * Performance: Uses NodeIndex for O(1) node lookup
 */

import { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { CronJob } from 'cron';

// Import Redis client
import redis from './redis.js';

// Authentication
import { readAuthConfig } from './auth/config.js';
import { createTokenVerifier } from './auth/verifyToken.js';
import { createRequireUser } from './auth/requireUser.js';

// Import services
import { runHabitCounter } from './services/dailyHabitCounter.js';
import { scanGraphKeys } from './services/graphKeys.js';
import { broadcastToGraph } from './handlers/broadcast.js';
import { getNodeIndex } from './services/nodeIndex.js';
import { createJournal } from './services/journal.js';
import { createSpendLedger } from './ai/spend.js';

// Import handlers
import { setupWebSocketHandler } from './handlers/websocketHandler.js';
import { createOperationHandler } from './handlers/operationHandler.js';

// Import routes
import { setupGraphRoutes } from './routes/graphRoutes.js';
import { setupAIRoutes } from './routes/aiRoutes.js';

// Import logger
import { logger } from './utils/logger.js';

// Whom this process believes about who is asking. A missing or contradictory
// configuration throws here, and the server does not start.
const authConfig = readAuthConfig(process.env);
const verifyToken = createTokenVerifier(authConfig);

// Initialize Express app
const app = express();
// cors() answers preflight requests itself, so they never reach requireUser.
app.use(cors());
// Ahead of the body parser: a request that proves no user is not worth parsing.
app.use('/api', createRequireUser(verifyToken));
app.use(express.json());

// Initialize HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Track connected clients
const clients = new Map();

// What changed and what the agent did, per user and graph. Read it with
// `npm run journal`.
const journal = createJournal(redis);

// What one person, and everyone together, may spend on AI in a calendar month.
// Both are dollars of real API cost. The defaults are deliberately small: the
// beta is friends, and sign-up is open to anyone who finds the URL.
const ledger = createSpendLedger(redis, {
  userQuota: Number(process.env.AI_USER_MONTHLY_QUOTA_USD ?? 2),
  globalCap: Number(process.env.AI_GLOBAL_MONTHLY_CAP_USD ?? 25),
});

/**
 * Redis Operations - Core data access
 * Now with NodeIndex integration for O(1) lookups
 *
 * A graph lives only under its owner's key. There is no default owner and no
 * shared fallback key: a graph that is not the user's does not exist for them.
 */
async function getGraph(graphId, userId) {
  if (!userId) throw new Error(`getGraph ${graphId} without a userId`);

  try {
    logger.debug(`Getting graph: ${graphId} for user: ${userId}`);

    const data = await redis.get(`user:${userId}:graph:${graphId}`);

    if (!data) {
      logger.debug(`Graph ${graphId} not found, returning empty graph`);
      return {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        version: 0,
        userId: userId
      };
    }

    const graph = JSON.parse(data);
    if (!graph.userId) {
      graph.userId = userId;
    }

    // Build NodeIndex for O(1) lookups
    const indexKey = `${userId}:${graphId}`;
    const nodeIndex = getNodeIndex(indexKey);
    nodeIndex.buildIndex(graph);

    logger.success(`Graph ${graphId} loaded: ${graph.nodes.length} nodes, index size: ${nodeIndex.size}`);
    return graph;
  } catch (error) {
    logger.error('Redis get error:', error);
    return null;
  }
}

async function saveGraph(graphId, graph, userId) {
  if (!userId) throw new Error(`saveGraph ${graphId} without a userId`);

  try {
    graph.version = (graph.version || 0) + 1;
    graph.lastUpdated = new Date().toISOString();
    graph.userId = userId;

    const graphData = JSON.stringify(graph);
    const redisKey = `user:${userId}:graph:${graphId}`;

    logger.debug(`Saving graph ${graphId}: ${graph.nodes.length} nodes, version ${graph.version}`);

    await redis.set(redisKey, graphData);
    logger.success(`Graph ${graphId} saved successfully`);

    // Save to history
    const historyKey = `history:${userId}:${graphId}:${Date.now()}`;
    await redis.setex(historyKey, 3600, graphData);

    return true;
  } catch (error) {
    logger.error('Redis save error:', error);
    return false;
  }
}

/**
 * Get NodeIndex for a specific graph
 * Used by operations for O(1) node lookup
 */
function getGraphNodeIndex(graphId, userId) {
  if (!userId) throw new Error(`getGraphNodeIndex ${graphId} without a userId`);
  const indexKey = `${userId}:${graphId}`;
  return getNodeIndex(indexKey);
}

// Create operation handler with dependencies
const applyOperation = createOperationHandler({
  getGraph,
  saveGraph,
  getNodeIndex: getGraphNodeIndex,
  journal
});

// Setup WebSocket handler
setupWebSocketHandler({
  wss,
  clients,
  getGraph,
  saveGraph,
  applyOperation,
  verifyToken
});

// Setup REST API routes
app.use('/api', setupGraphRoutes({ getGraph, saveGraph, clients }));
app.use('/api/ai', setupAIRoutes({ getGraph, journal, ledger }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    redis: redis.status === 'ready',
    websocket: wss.clients.size,
    timestamp: new Date().toISOString()
  });
});

// The counter needs no index; reading through getGraph would repoint the
// shared NodeIndex at a copy the queue is not working on.
async function readGraph(graphId, userId) {
  const raw = await redis.get(`user:${userId}:graph:${graphId}`);
  return raw === null ? { nodes: [], edges: [] } : JSON.parse(raw);
}

// Count yesterday's ticked habits for every user at midnight. HABIT_COUNTER_CRON
// lets a rehearsal run it every few seconds instead of waiting for midnight.
const habitCounterJob = CronJob.from({
  cronTime: process.env.HABIT_COUNTER_CRON || '0 0 * * *',
  // A slow run must not overlap the next and count a day twice.
  waitForCompletion: true,
  onTick: async () => {
    logger.info('🌙 Running daily habit counter job...');
    try {
      const result = await runHabitCounter({
        graphs: scanGraphKeys(redis),
        getGraph: readGraph,
        applyOperation,
        broadcast: (target, message) => broadcastToGraph(clients, target, message),
      });
      logger.success(
        `🌙 Daily habit counter completed: ${result.nodes} habits in ${result.graphs} graphs, ${result.failed} graphs failed, ${result.refused} updates refused`
      );
    } catch (error) {
      logger.error('🌙 Daily habit counter failed:', error);
    }
  },
  start: true,
  timeZone: 'Europe/Belgrade',
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   Optimistic UI Server (Refactored)   ║
╠═══════════════════════════════════════╣
║   WebSocket: ws://localhost:${PORT}      ║
║   REST API:  http://localhost:${PORT}    ║
║   Redis:     ${redis.options.host}:${redis.options.port}         ║
║   NodeIndex: O(1) lookups enabled     ║
╚═══════════════════════════════════════╝
  `);
  logger.info(`🔐 Trusting tokens from ${authConfig.issuer} for ${authConfig.audience}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing connections...');

  wss.clients.forEach((client) => {
    client.close();
  });

  redis.disconnect();

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export { app, wss };
