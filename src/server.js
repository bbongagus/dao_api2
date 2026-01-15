/**
 * Simple Optimistic UI Server - Refactored Version
 * Main entry point - coordinates all modules
 * 
 * Original: simple-server.js (1136 lines)
 * Refactored: server.js (~200 lines) + modular imports
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

// Import services
import SimplifiedAnalytics from './analytics-v2.js';
import progressSnapshots from './progress-snapshots.js';
import dailyHabitCounter from './services/dailyHabitCounter.js';
import { DEFAULT_USER_ID } from './services/graphService.js';
import { getNodeIndex, clearNodeIndex } from './services/nodeIndex.js';

// Import handlers
import { setupWebSocketHandler } from './handlers/websocketHandler.js';
import { createOperationHandler } from './handlers/operationHandler.js';

// Import routes
import { setupGraphRoutes } from './routes/graphRoutes.js';
import { setupAnalyticsRoutes } from './routes/analyticsRoutes.js';
import { setupAIRoutes } from './routes/aiRoutes.js';

// Import logger
import { logger } from './utils/logger.js';

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Track connected clients
const clients = new Map();

// Initialize Analytics Service
const analytics = new SimplifiedAnalytics(redis);

/**
 * Redis Operations - Core data access
 * Now with NodeIndex integration for O(1) lookups
 */
async function getGraph(graphId, userId = DEFAULT_USER_ID) {
  try {
    logger.debug(`Getting graph: ${graphId} for user: ${userId}`);
    
    // Try user-specific key first
    let data = await redis.get(`user:${userId}:graph:${graphId}`);
    
    // Fallback to old key format for backward compatibility
    if (!data) {
      data = await redis.get(`graph:${graphId}`);
      if (data) {
        logger.debug(`Found graph in old format, will migrate on save`);
      }
    }
    
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

async function saveGraph(graphId, graph, userId = DEFAULT_USER_ID) {
  try {
    graph.version = (graph.version || 0) + 1;
    graph.lastUpdated = new Date().toISOString();
    graph.userId = userId;
    
    const graphData = JSON.stringify(graph);
    const redisKey = `user:${userId}:graph:${graphId}`;
    
    logger.debug(`Saving graph ${graphId}: ${graph.nodes.length} nodes, version ${graph.version}`);
    
    await redis.set(redisKey, graphData);
    logger.success(`Graph ${graphId} saved successfully`);
    
    // Clean up old key format
    const oldKey = `graph:${graphId}`;
    const oldData = await redis.get(oldKey);
    if (oldData) {
      await redis.del(oldKey);
      logger.debug(`Cleaned up old key format: ${oldKey}`);
    }
    
    // Save to history
    const historyKey = `history:${userId}:${graphId}:${Date.now()}`;
    await redis.setex(historyKey, 3600, graphData);
    
    return true;
  } catch (error) {
    logger.error('Redis save error:', error);
    return false;
  }
}

async function addOperation(graphId, operation) {
  try {
    const key = `operations:${graphId}`;
    await redis.lpush(key, JSON.stringify(operation));
    await redis.ltrim(key, 0, 99);
    return true;
  } catch (error) {
    logger.error('Redis operation error:', error);
    return false;
  }
}

/**
 * Get NodeIndex for a specific graph
 * Used by operations for O(1) node lookup
 */
function getGraphNodeIndex(graphId, userId = DEFAULT_USER_ID) {
  const indexKey = `${userId}:${graphId}`;
  return getNodeIndex(indexKey);
}

// Create operation handler with dependencies
const applyOperation = createOperationHandler({
  getGraph,
  saveGraph,
  addOperation,
  analytics,
  getNodeIndex: getGraphNodeIndex
});

// Setup WebSocket handler
setupWebSocketHandler({
  wss,
  clients,
  getGraph,
  saveGraph,
  addOperation,
  applyOperation
});

// Setup REST API routes
app.use('/api', setupGraphRoutes({ getGraph, saveGraph, clients }));
app.use('/api/analytics', setupAnalyticsRoutes({ analytics, progressSnapshots }));
app.use('/api/ai', setupAIRoutes());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    redis: redis.status === 'ready',
    websocket: wss.clients.size,
    timestamp: new Date().toISOString()
  });
});

// Initialize daily snapshot job at 00:00 every day
const snapshotJob = new CronJob(
  '0 0 * * *',
  async () => {
    logger.info('Running daily progress snapshot job...');
    try {
      const snapshots = await progressSnapshots.snapshotAllNodes(new Date(), DEFAULT_USER_ID, 'main');
      logger.success(`Daily snapshot completed: ${snapshots.length} nodes`);
    } catch (error) {
      logger.error('Daily snapshot failed:', error);
    }
  },
  null,
  true,
  'Europe/Belgrade'
);

// Run initial snapshot on startup
setTimeout(async () => {
  logger.info('Running initial progress snapshot...');
  try {
    const snapshots = await progressSnapshots.snapshotAllNodes(new Date(), DEFAULT_USER_ID, 'main');
    logger.success(`Initial snapshot completed: ${snapshots.length} nodes`);
  } catch (error) {
    logger.error('Initial snapshot failed:', error);
  }
}, 5000);

logger.success('Progress Snapshots Service initialized');

// Initialize daily habit counter job at 00:00 every day
const habitCounterJob = new CronJob(
  '0 0 * * *',
  async () => {
    logger.info('🌙 Running daily habit counter job...');
    try {
      const result = await dailyHabitCounter.processAllGraphs(DEFAULT_USER_ID);
      logger.success(
        `🌙 Daily habit counter completed: ${result.incrementedCount}/${result.processedCount} nodes incremented`
      );
    } catch (error) {
      logger.error('🌙 Daily habit counter failed:', error);
    }
  },
  null,
  true,
  'Europe/Belgrade'
);

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
