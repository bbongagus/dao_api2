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
import { runHabitCounter, habitCounterEnabled } from './services/dailyHabitCounter.js';
import { scanGraphKeys } from './services/graphKeys.js';
import { broadcastToGraph } from './handlers/broadcast.js';
import { getNodeIndex } from './services/nodeIndex.js';
import { createJournal } from './services/journal.js';
import { createSpendLedger, ledgerLimits } from './ai/spend.js';
import { healthReport } from './health.js';
import { corsOptions } from './corsPolicy.js';

// Import handlers
import { setupWebSocketHandler } from './handlers/websocketHandler.js';
import { createOperationHandler, graphQueue } from './handlers/operationHandler.js';

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
// Narrowed to where this app is served from — see corsPolicy.js. CORS_ORIGINS
// overrides, comma separated.
app.use(cors(corsOptions()));
// Ahead of the body parser: a request that proves no user is not worth parsing.
app.use('/api', createRequireUser(verifyToken));
app.use(express.json());

// Initialize HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
// A megabyte is far above any operation this protocol sends — the graph itself
// never comes in over the socket — and far below what an unbounded frame could
// make the server allocate.
const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });

// Track connected clients
const clients = new Map();

// What changed and what the agent did, per user and graph. Read it with
// `npm run journal`.
const journal = createJournal(redis);

// What one person, and everyone together, may spend on AI in a calendar month.
// Both are dollars of real API cost. The defaults are deliberately small: the
// beta is friends, and sign-up is open to anyone who finds the URL.
const ledger = createSpendLedger(redis, ledgerLimits());

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
app.use('/api', setupGraphRoutes({ getGraph, saveGraph, clients, graphQueue }));
app.use('/api/ai', setupAIRoutes({ getGraph, journal, ledger }));

// Health check endpoint
app.get('/health', (req, res) => {
  const { status, body } = healthReport({ redisStatus: redis.status, clients: wss.clients.size });
  res.status(status).json(body);
});

// The counter needs no index; reading through getGraph would repoint the
// shared NodeIndex at a copy the queue is not working on.
async function readGraph(graphId, userId) {
  const raw = await redis.get(`user:${userId}:graph:${graphId}`);
  return raw === null ? { nodes: [], edges: [] } : JSON.parse(raw);
}

// Count yesterday's ticked habits for every user at midnight. The job runs
// only with HABIT_COUNTER_ENABLED=true. HABIT_COUNTER_CRON lets a rehearsal
// run it every few seconds instead of waiting for midnight.
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
  start: habitCounterEnabled(process.env),
  timeZone: 'Europe/Belgrade',
});

if (!habitCounterJob.running) logger.info('🌙 Habit counter off (HABIT_COUNTER_ENABLED is not "true")');

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

// Graceful shutdown.
//
// The old version disconnected Redis first and never waited for the operation
// queue, so a save in flight was cut off mid-write — on a platform that sends
// SIGTERM before every deploy. Order matters: stop taking work, let what is
// running finish, then let Redis go.
let shuttingDown = false;

async function shutDown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, closing connections...`);

  server.close(() => logger.info('Server closed to new connections'));
  wss.clients.forEach((client) => client.close());

  const { pending, timedOut } = await graphQueue.drain({ timeoutMs: 5000 });
  if (timedOut) logger.error(`Shutdown: ${pending} queued operation(s) did not finish in time`);
  else if (pending) logger.info(`Shutdown: ${pending} queued operation(s) finished`);

  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutDown('SIGTERM'));
// Ctrl-C in a terminal. Without this the dev server died without draining.
process.on('SIGINT', () => shutDown('SIGINT'));

// A rejection nobody caught used to end the process silently on some Node
// versions and be invisible on others. Log it; do not pretend it is fatal.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason?.stack || reason}`);
});

export { app, wss };
