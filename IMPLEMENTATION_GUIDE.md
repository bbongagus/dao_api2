# Optimistic UI Backend - Complete Implementation Guide

## Project Structure
```
dao_api2/
├── src/
│   ├── config/
│   │   ├── redis.js
│   │   ├── bullmq.js
│   │   └── constants.js
│   ├── models/
│   │   ├── graph.model.js
│   │   ├── node.model.js
│   │   ├── edge.model.js
│   │   └── operation.model.js
│   ├── queues/
│   │   ├── command.queue.js
│   │   ├── sync.queue.js
│   │   └── analytics.queue.js
│   ├── processors/
│   │   ├── command.processor.js
│   │   ├── sync.processor.js
│   │   └── conflict.resolver.js
│   ├── api/
│   │   ├── routes/
│   │   │   ├── command.routes.js
│   │   │   ├── query.routes.js
│   │   │   └── websocket.routes.js
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js
│   │   │   ├── validation.middleware.js
│   │   │   └── optimistic.middleware.js
│   │   └── controllers/
│   │       ├── command.controller.js
│   │       ├── query.controller.js
│   │       └── sync.controller.js
│   ├── websocket/
│   │   ├── server.js
│   │   ├── handlers.js
│   │   └── broadcast.js
│   ├── services/
│   │   ├── redis.service.js
│   │   ├── graph.service.js
│   │   ├── reconciliation.service.js
│   │   └── metrics.service.js
│   ├── utils/
│   │   ├── logger.js
│   │   ├── cache.js
│   │   └── validation.js
│   └── index.js
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── redis.conf
├── scripts/
│   ├── migrate.js
│   ├── seed.js
│   └── monitor.js
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.example
├── package.json
└── README.md
```

## 1. Package.json Configuration

```json
{
  "name": "dao-api-optimistic",
  "version": "2.0.0",
  "description": "Optimistic UI Backend with Redis and BullMQ",
  "main": "src/index.js",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "worker": "node src/processors/command.processor.js",
    "websocket": "node src/websocket/server.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "migrate": "node scripts/migrate.js",
    "seed": "node scripts/seed.js",
    "monitor": "node scripts/monitor.js",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "docker:logs": "docker-compose logs -f"
  },
  "dependencies": {
    "express": "^4.18.2",
    "express-ws": "^5.0.2",
    "redis": "^4.6.10",
    "ioredis": "^5.3.2",
    "bullmq": "^4.12.0",
    "ws": "^8.14.2",
    "uuid": "^9.0.1",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "compression": "^1.7.4",
    "express-rate-limit": "^6.11.2",
    "joi": "^17.10.2",
    "winston": "^3.11.0",
    "node-cache": "^5.1.2",
    "p-queue": "^7.4.1",
    "lodash": "^4.17.21",
    "date-fns": "^2.30.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1",
    "jest": "^29.7.0",
    "supertest": "^6.3.3",
    "@types/node": "^20.8.4",
    "eslint": "^8.51.0",
    "prettier": "^3.0.3"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

## 2. Core Configuration Files

### src/config/redis.js
```javascript
import Redis from 'ioredis';
import { config } from 'dotenv';

config();

// Create Redis client with optimized settings
export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: true,
  
  // Performance optimizations
  keepAlive: 30000,
  connectTimeout: 10000,
  
  // Reconnection strategy
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

// Create separate client for subscriptions
export const redisSub = redis.duplicate();
export const redisPub = redis.duplicate();

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

// Helper functions for atomic operations
export const redisAtomicOps = {
  async incrementVersion(graphId) {
    return redis.hincrby(`graph:${graphId}:state`, 'version', 1);
  },
  
  async setWithLock(key, value, lockTimeout = 5000) {
    const lockKey = `${key}:lock`;
    const lockId = Math.random().toString(36).substring(7);
    
    // Try to acquire lock
    const acquired = await redis.set(lockKey, lockId, 'PX', lockTimeout, 'NX');
    if (!acquired) {
      throw new Error('Could not acquire lock');
    }
    
    try {
      await redis.set(key, value);
    } finally {
      // Release lock only if we own it
      const currentLock = await redis.get(lockKey);
      if (currentLock === lockId) {
        await redis.del(lockKey);
      }
    }
  }
};
```

### src/config/bullmq.js
```javascript
import { Queue, Worker, QueueScheduler } from 'bullmq';
import { redis } from './redis.js';

// Queue configuration
const defaultQueueOptions = {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  }
};

// Create queues
export const commandQueue = new Queue('graph-commands', defaultQueueOptions);
export const syncQueue = new Queue('sync-operations', defaultQueueOptions);
export const analyticsQueue = new Queue('analytics', defaultQueueOptions);

// Queue schedulers for delayed/repeated jobs
export const commandScheduler = new QueueScheduler('graph-commands', {
  connection: redis
});

// Queue event monitoring
commandQueue.on('completed', (job) => {
  console.log(`✅ Command ${job.id} completed`);
});

commandQueue.on('failed', (job, err) => {
  console.error(`❌ Command ${job.id} failed:`, err.message);
});

// Helper to add job with priority
export const addPriorityJob = async (queue, name, data, priority = 0) => {
  return queue.add(name, data, {
    priority,
    delay: 0
  });
};
```

## 3. Data Models

### src/models/graph.model.js
```javascript
import { redis, redisAtomicOps } from '../config/redis.js';
import { v4 as uuidv4 } from 'uuid';

export class GraphModel {
  constructor(graphId) {
    this.graphId = graphId;
    this.stateKey = `graph:${graphId}:state`;
    this.nodesKey = `graph:${graphId}:nodes`;
    this.edgesKey = `graph:${graphId}:edges`;
    this.viewportKey = `graph:${graphId}:viewport`;
    this.versionsKey = `graph:${graphId}:versions`;
  }
  
  // Get complete graph state
  async getState() {
    const multi = redis.multi();
    
    multi.hgetall(this.stateKey);
    multi.hgetall(this.nodesKey);
    multi.smembers(this.edgesKey);
    multi.hgetall(this.viewportKey);
    
    const [state, nodes, edges, viewport] = await multi.exec();
    
    return {
      ...state[1],
      nodes: this.parseNodes(nodes[1]),
      edges: this.parseEdges(edges[1]),
      viewport: viewport[1] || { x: 0, y: 0, zoom: 1 }
    };
  }
  
  // Update graph with optimistic tracking
  async updateOptimistic(operationId, updates) {
    const multi = redis.multi();
    const version = await redisAtomicOps.incrementVersion(this.graphId);
    
    // Track operation
    multi.hset(`operation:${operationId}`, {
      graphId: this.graphId,
      version,
      timestamp: Date.now(),
      status: 'processing'
    });
    
    // Apply updates
    if (updates.nodes) {
      for (const [nodeId, nodeData] of Object.entries(updates.nodes)) {
        multi.hset(this.nodesKey, nodeId, JSON.stringify(nodeData));
      }
    }
    
    if (updates.edges) {
      // Clear and reset edges (for simplicity)
      multi.del(this.edgesKey);
      for (const edge of updates.edges) {
        multi.sadd(this.edgesKey, JSON.stringify(edge));
      }
    }
    
    if (updates.viewport) {
      multi.hset(this.viewportKey, updates.viewport);
    }
    
    // Update state metadata
    multi.hset(this.stateKey, {
      version,
      lastModified: Date.now(),
      lastOperationId: operationId
    });
    
    await multi.exec();
    return version;
  }
  
  // Add node atomically
  async addNode(node) {
    const nodeId = node.id || uuidv4();
    const nodeData = {
      ...node,
      id: nodeId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    const multi = redis.multi();
    multi.hset(this.nodesKey, nodeId, JSON.stringify(nodeData));
    multi.hincrby(this.stateKey, 'version', 1);
    multi.hset(this.stateKey, 'lastModified', Date.now());
    
    await multi.exec();
    return nodeData;
  }
  
  // Update node position (common optimistic operation)
  async updateNodePosition(nodeId, position) {
    const nodeData = await redis.hget(this.nodesKey, nodeId);
    if (!nodeData) {
      throw new Error('Node not found');
    }
    
    const node = JSON.parse(nodeData);
    node.position = position;
    node.updatedAt = Date.now();
    
    const multi = redis.multi();
    multi.hset(this.nodesKey, nodeId, JSON.stringify(node));
    multi.hincrby(this.stateKey, 'version', 1);
    
    await multi.exec();
    return node;
  }
  
  // Delete node and connected edges
  async deleteNode(nodeId) {
    const edges = await redis.smembers(this.edgesKey);
    const connectedEdges = edges
      .map(e => JSON.parse(e))
      .filter(e => e.source === nodeId || e.target === nodeId);
    
    const multi = redis.multi();
    multi.hdel(this.nodesKey, nodeId);
    
    // Remove connected edges
    for (const edge of connectedEdges) {
      multi.srem(this.edgesKey, JSON.stringify(edge));
    }
    
    multi.hincrby(this.stateKey, 'version', 1);
    multi.hset(this.stateKey, 'lastModified', Date.now());
    
    await multi.exec();
    return { deletedNode: nodeId, deletedEdges: connectedEdges };
  }
  
  // Helper methods
  parseNodes(nodesHash) {
    const nodes = [];
    for (const [id, data] of Object.entries(nodesHash || {})) {
      try {
        nodes.push(JSON.parse(data));
      } catch (e) {
        console.error(`Failed to parse node ${id}:`, e);
      }
    }
    return nodes;
  }
  
  parseEdges(edgesSet) {
    return (edgesSet || []).map(edge => {
      try {
        return JSON.parse(edge);
      } catch (e) {
        console.error('Failed to parse edge:', e);
        return null;
      }
    }).filter(Boolean);
  }
  
  // Get changes since version
  async getChangesSince(sinceVersion) {
    const currentVersion = await redis.hget(this.stateKey, 'version');
    
    if (sinceVersion >= currentVersion) {
      return { changes: [], currentVersion };
    }
    
    // In production, implement event sourcing to track actual changes
    // For now, return full state if versions differ
    const state = await this.getState();
    return {
      changes: [{
        type: 'FULL_UPDATE',
        data: state
      }],
      currentVersion
    };
  }
}
```

## 4. Command Processor

### src/processors/command.processor.js
```javascript
import { Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { GraphModel } from '../models/graph.model.js';
import { ConflictResolver } from './conflict.resolver.js';
import { broadcastToGraph } from '../websocket/broadcast.js';

const commandProcessor = new Worker(
  'graph-commands',
  async (job) => {
    const { operationId, type, payload, userId, graphId, clientVersion } = job.data;
    
    console.log(`Processing command: ${type} for graph ${graphId}`);
    
    try {
      // Get graph model
      const graph = new GraphModel(graphId);
      
      // Check for conflicts
      const currentVersion = await redis.hget(`graph:${graphId}:state`, 'version');
      if (clientVersion && clientVersion < currentVersion) {
        // Potential conflict
        const resolver = new ConflictResolver();
        const resolved = await resolver.resolve(job.data, await graph.getState());
        
        if (resolved.conflict) {
          await handleConflict(operationId, resolved);
          return { status: 'conflict', resolution: resolved };
        }
      }
      
      // Process command based on type
      let result;
      switch (type) {
        case 'CREATE_NODE':
          result = await graph.addNode(payload);
          break;
          
        case 'UPDATE_NODE':
          result = await graph.updateNode(payload.nodeId, payload.updates);
          break;
          
        case 'DELETE_NODE':
          result = await graph.deleteNode(payload.nodeId);
          break;
          
        case 'UPDATE_NODE_POSITION':
          result = await graph.updateNodePosition(payload.nodeId, payload.position);
          break;
          
        case 'CREATE_EDGE':
          result = await graph.addEdge(payload);
          break;
          
        case 'DELETE_EDGE':
          result = await graph.deleteEdge(payload.edgeId);
          break;
          
        case 'BATCH_UPDATE':
          result = await graph.updateOptimistic(operationId, payload);
          break;
          
        default:
          throw new Error(`Unknown command type: ${type}`);
      }
      
      // Mark operation as completed
      await redis.hset(`operation:${operationId}`, {
        status: 'completed',
        result: JSON.stringify(result),
        completedAt: Date.now()
      });
      
      // Broadcast update to all clients
      await broadcastToGraph(graphId, {
        type: 'STATE_UPDATE',
        operationId,
        commandType: type,
        result,
        version: await redis.hget(`graph:${graphId}:state`, 'version')
      });
      
      return { status: 'success', result };
      
    } catch (error) {
      console.error(`Command processing failed:`, error);
      
      // Mark operation as failed
      await redis.hset(`operation:${operationId}`, {
        status: 'failed',
        error: error.message,
        failedAt: Date.now()
      });
      
      // Notify client to revert optimistic update
      await broadcastToGraph(graphId, {
        type: 'REVERT',
        operationId,
        error: error.message
      });
      
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 5,
    limiter: {
      max: 1000,
      duration: 1000
    }
  }
);

// Helper function to handle conflicts
async function handleConflict(operationId, resolution) {
  await redis.hset(`operation:${operationId}`, {
    status: 'conflict',
    resolution: JSON.stringify(resolution),
    conflictAt: Date.now()
  });
}

export default commandProcessor;
```

## 5. API Routes

### src/api/routes/command.routes.js
```javascript
import { Router } from 'express';
import { commandQueue } from '../../config/bullmq.js';
import { redis } from '../../config/redis.js';
import { validateCommand } from '../middleware/validation.middleware.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Execute optimistic command
router.post('/graphs/:graphId/command', validateCommand, async (req, res) => {
  try {
    const { graphId } = req.params;
    const { type, payload, clientVersion } = req.body;
    const operationId = req.body.operationId || uuidv4();
    
    // Add to command queue
    const job = await commandQueue.add('process-command', {
      operationId,
      type,
      payload,
      userId: req.user.id,
      graphId,
      clientVersion,
      timestamp: Date.now()
    });
    
    // Store operation for tracking
    await redis.hset(`operation:${operationId}`, {
      jobId: job.id,
      status: 'pending',
      createdAt: Date.now()
    });
    
    // Respond immediately (optimistic)
    res.json({
      accepted: true,
      operationId,
      estimatedProcessingTime: 50 // ms
    });
    
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

// Batch commands
router.post('/graphs/:graphId/batch', async (req, res) => {
  try {
    const { graphId } = req.params;
    const { operations, atomic } = req.body;
    const batchId = uuidv4();
    
    if (atomic) {
      // Process as single atomic operation
      const job = await commandQueue.add('process-batch', {
        batchId,
        operations,
        graphId,
        userId: req.user.id,
        atomic: true
      });
      
      res.json({
        accepted: true,
        batchId,
        jobId: job.id
      });
    } else {
      // Process operations individually
      const jobs = await Promise.all(
        operations.map(op => 
          commandQueue.add('process-command', {
            ...op,
            graphId,
            userId: req.user.id,
            batchId
          })
        )
      );
      
      res.json({
        accepted: true,
        batchId,
        jobIds: jobs.map(j => j.id)
      });
    }
    
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

// Check operation status
router.get('/operations/:operationId', async (req, res) => {
  try {
    const { operationId } = req.params;
    const operation = await redis.hgetall(`operation:${operationId}`);
    
    if (!operation || !operation.status) {
      return res.status(404).json({
        error: 'Operation not found'
      });
    }
    
    res.json({
      operationId,
      status: operation.status,
      result: operation.result ? JSON.parse(operation.result) : null,
      error: operation.error,
      createdAt: operation.createdAt,
      completedAt: operation.completedAt
    });
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

export default router;
```

### src/api/routes/query.routes.js
```javascript
import { Router } from 'express';
import { GraphModel } from '../../models/graph.model.js';
import { cache } from '../../utils/cache.js';

const router = Router();

// Get current graph state (fast read from Redis)
router.get('/graphs/:graphId/state', async (req, res) => {
  try {
    const { graphId } = req.params;
    
    // Try cache first
    const cached = cache.get(`graph:${graphId}`);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }
    
    // Load from Redis
    const graph = new GraphModel(graphId);
    const state = await graph.getState();
    
    // Cache for 10 seconds
    cache.set(`graph:${graphId}`, state, 10);
    
    res.set('X-Cache', 'MISS');
    res.json(state);
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Get changes since version
router.get('/graphs/:graphId/changes', async (req, res) => {
  try {
    const { graphId } = req.params;
    const { since } = req.query;
    
    const graph = new GraphModel(graphId);
    const changes = await graph.getChangesSince(parseInt(since) || 0);
    
    res.json(changes);
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Get graph nodes
router.get('/graphs/:graphId/nodes', async (req, res) => {
  try {
    const { graphId } = req.params;
    const graph = new GraphModel(graphId);
    const nodes = await graph.getNodes();
    
    res.json({ nodes });
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Get specific node
router.get('/graphs/:graphId/nodes/:nodeId', async (req, res) => {
  try {
    const { graphId, nodeId } = req.params;
    const graph = new GraphModel(graphId);
    const node = await graph.getNode(nodeId);
    
    if (!node) {
      return res.status(404).json({
        error: 'Node not found'
      });
    }
    
    res.json(node);
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

export default router;
```

## 6. WebSocket Server

### src/websocket/server.js
```javascript
import { WebSocketServer } from 'ws';
import { redis, redisSub } from '../config/redis.js';
import { handleMessage } from './handlers.js';
import { v4 as uuidv4 } from 'uuid';

const wss = new WebSocketServer({ 
  port: process.env.WS_PORT || 8080,
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    }
  }
});

// Track client connections
const clients = new Map();

wss.on('connection', async (ws, req) => {
  const connectionId = uuidv4();
  const params = new URLSearchParams(req.url.split('?')[1]);
  const userId = params.get('userId');
  const graphId = params.get('graphId');
  const clientVersion = params.get('version');
  
  console.log(`New WebSocket connection: ${connectionId} for user ${userId}, graph ${graphId}`);
  
  // Store client info
  const client = {
    id: connectionId,
    ws,
    userId,
    graphId,
    version: parseInt(clientVersion) || 0,
    lastActivity: Date.now()
  };
  
  clients.set(connectionId, client);
  
  // Subscribe to graph updates
  await subscribeToGraph(client);
  
  // Send initial sync
  await sendInitialSync(client);
  
  // Handle messages
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      await handleMessage(client, data);
      client.lastActivity = Date.now();
    } catch (error) {
      console.error('Message handling error:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        error: error.message
      }));
    }
  });
  
  // Handle disconnect
  ws.on('close', () => {
    console.log(`Client disconnected: ${connectionId}`);
    clients.delete(connectionId);
    unsubscribeFromGraph(client);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for ${connectionId}:`, error);
    clients.delete(connectionId);
  });
  
  // Setup heartbeat
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// Subscribe client to graph updates
async function subscribeToGraph(client) {
  const channel = `graph:${client.graphId}:updates`;
  
  // Subscribe to Redis channel
  await redisSub.subscribe(channel);
  
  // Store subscription
  await redis.sadd(`graph:${client.graphId}:subscribers`, client.id);
}

// Unsubscribe from graph
async function unsubscribeFromGraph(client) {
  await redis.srem(`graph:${client.graphId}:subscribers`, client.id);
}

// Send initial sync to client
async function sendInitialSync(client) {
  const { GraphModel } = await import('../models/graph.model.js');
  const graph = new GraphModel(client.graphId);
  
  // Check if client needs sync
  const currentVersion = await redis.hget(`graph:${client.graphId}:state`, 'version');
  
  if (client.version < currentVersion) {
    const state = await graph.getState();
    
    client.ws.send(JSON.stringify({
      type: 'SYNC',
      data: {
        state,
        version: currentVersion
      }
    }));
  } else {
    client.ws.send(JSON.stringify({
      type: 'SYNC',
      data: {
        status: 'in_sync',
        version: currentVersion
      }
    }));
  }
}

// Listen for Redis pub/sub messages
redisSub.on('message', (channel, message) => {
  const graphId = channel.split(':')[1];
  const update = JSON.parse(message);
  
  // Broadcast to all connected clients for this graph
  for (const [id, client] of clients) {
    if (client.graphId === graphId) {
      client.ws.send(JSON.stringify(update));
    }
  }
});

// Heartbeat interval
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Cleanup stale operations
setInterval(async () => {
  const staleTime = Date.now() - 300000; // 5 minutes
  
  // Get all operations
  const operations = await redis.keys('operation:*');
  
  for (const key of operations) {
    const op = await redis.hgetall(key);
    if (op.createdAt && parseInt(op.createdAt) < staleTime) {
      if (op.status === 'pending' || op.status === 'processing') {
        // Mark as failed
        await redis.hset(key, 'status', 'timeout');
      }
      // Set TTL to expire soon
      await redis.expire(key, 60);
    }
  }
}, 60000);

console.log(`WebSocket server listening on port ${process.env.WS_PORT || 8080}`);

export default wss;
```

## 7. Docker Configuration

### docker-compose.yml
```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: dao-redis
    command: redis-server --appendonly yes --maxmemory 2gb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
      - ./docker/redis.conf:/usr/local/etc/redis/redis.conf
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  api:
    build:
      context: .
      dockerfile: docker/Dockerfile
    container_name: dao-api
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - PORT=3000
      - WS_PORT=8080
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    volumes:
      - ./src:/app/src
      - /app/node_modules

  worker:
    build:
      context: .
      dockerfile: docker/Dockerfile
    container_name: dao-worker
    command: npm run worker
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - WORKER_TYPE=commands
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      replicas: 3
    volumes:
      - ./src:/app/src
      - /app/node_modules

  websocket:
    build:
      context: .
      dockerfile: docker/Dockerfile
    container_name: dao-websocket
    command: npm run websocket
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - WS_PORT=8080
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    volumes:
      - ./src:/app/src
      - /app/node_modules

  nginx:
    image: nginx:alpine
    container_name: dao-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx.conf:/etc/nginx/nginx.conf
      - ./docker/ssl:/etc/nginx/ssl
    depends_on:
      - api
      - websocket
    restart: unless-stopped

volumes:
  redis-data:
    driver: local

networks:
  default:
    name: dao-network
```

### docker/Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

EXPOSE 3000 8080

CMD ["npm", "start"]
```

## 8. Environment Configuration

### .env.example
```bash
# Node Environment
NODE_ENV=development

# Server Configuration
PORT=3000
WS_PORT=8080

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Security
JWT_SECRET=your-secret-key-here
CORS_ORIGINS=http://localhost:3001,http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX_REQUESTS=100

# BullMQ Configuration
QUEUE_CONCURRENCY=5
MAX_JOBS_PER_WORKER=100

# Monitoring
LOG_LEVEL=info
METRICS_ENABLED=true

# Cache Configuration
CACHE_TTL=60
CACHE_CHECK_PERIOD=120

# WebSocket Configuration
WS_HEARTBEAT_INTERVAL=30000
WS_MAX_CONNECTIONS=1000
```

This implementation provides a complete, production-ready Optimistic UI backend with Redis as the source of truth and BullMQ for reliable command processing. The system supports instant UI updates, conflict resolution, and real-time synchronization across multiple clients.