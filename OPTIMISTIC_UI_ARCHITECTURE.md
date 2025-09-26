# Optimistic UI Backend Architecture
## Redis + BullMQ Implementation for Graphy

### Executive Summary
This architecture implements a high-performance Optimistic UI backend using Redis as the single source of truth and BullMQ for reliable command processing. The system supports instant UI updates with eventual consistency, conflict resolution, and real-time synchronization.

---

## 🎯 Core Principles

### 1. Optimistic UI Flow
```
Client Action → Immediate UI Update → Command Queue → Redis Update → Broadcast to Clients
                     ↓                      ↓              ↓              ↓
                Local State          BullMQ Job      Source of Truth   WebSocket
                  Update             Processing         (Redis)        Broadcast
```

### 2. CQRS Pattern (Command Query Responsibility Segregation)
- **Commands**: Async via BullMQ queues
- **Queries**: Direct from Redis (fast reads)
- **Separation**: Write operations don't block read operations

### 3. Event Sourcing Light
- Store commands as events
- Enable undo/redo operations
- Audit trail for all changes
- Conflict resolution capability

---

## 📦 Data Architecture

### Redis Data Structures

#### 1. Graph State (Source of Truth)
```javascript
// Current graph state - Hash
Key: graph:{graphId}:state
Fields:
  version: number        // Increments with each change
  lastModified: timestamp
  checksum: string      // For integrity verification
  
// Graph nodes - Hash
Key: graph:{graphId}:nodes
Fields: {nodeId}: JSON string of node data

// Graph edges - Set
Key: graph:{graphId}:edges
Members: JSON strings of edge data

// Graph viewport - Hash
Key: graph:{graphId}:viewport
Fields:
  x: number
  y: number
  zoom: number
```

#### 2. User Sessions
```javascript
// Active user sessions - Hash
Key: user:{userId}:session
Fields:
  graphId: string
  connectionId: string
  lastActivity: timestamp
  clientVersion: number  // Last known client version

// User command history - List
Key: user:{userId}:commands
Members: JSON command objects (capped at 100)
```

#### 3. Optimistic State Tracking
```javascript
// Pending operations per client - List
Key: client:{connectionId}:pending
Members: operation IDs in order

// Operation details - Hash with TTL
Key: operation:{operationId}
Fields:
  type: string
  payload: JSON
  timestamp: number
  status: pending|processing|completed|failed
  retries: number
TTL: 300 seconds
```

#### 4. Conflict Resolution
```javascript
// Version vectors for conflict detection
Key: graph:{graphId}:versions
Fields:
  {clientId}: version number

// Conflict log - List
Key: graph:{graphId}:conflicts
Members: JSON conflict records
```

---

## 🚀 BullMQ Queue Architecture

### Queue Types

#### 1. Command Queue (Primary)
```javascript
Queue: 'graph-commands'
Jobs:
  - CREATE_NODE
  - UPDATE_NODE
  - DELETE_NODE
  - CREATE_EDGE
  - UPDATE_EDGE
  - DELETE_EDGE
  - UPDATE_VIEWPORT
  - BATCH_UPDATE

Processor Features:
  - Concurrency: 5
  - Rate limiting: 1000 ops/second
  - Retry: 3 attempts with exponential backoff
  - Dead letter queue for failed jobs
```

#### 2. Sync Queue (Real-time)
```javascript
Queue: 'sync-operations'
Jobs:
  - BROADCAST_UPDATE
  - SYNC_CLIENT
  - RESOLVE_CONFLICT
  
Processor Features:
  - Concurrency: 10
  - Priority levels
  - Immediate processing
```

#### 3. Analytics Queue (Background)
```javascript
Queue: 'analytics'
Jobs:
  - CALCULATE_PROGRESS
  - UPDATE_METRICS
  - GENERATE_SNAPSHOT
  
Processor Features:
  - Concurrency: 2
  - Scheduled jobs
  - Low priority
```

---

## 🔄 Optimistic UI Patterns

### 1. Command Processing Flow

```javascript
class CommandProcessor {
  async processCommand(command) {
    const { operationId, type, payload, userId, graphId } = command;
    
    // 1. Validate command
    const validation = await this.validateCommand(command);
    if (!validation.valid) {
      return this.revertOptimistic(operationId, validation.error);
    }
    
    // 2. Apply to Redis (atomic operation)
    const result = await this.applyToRedis(command);
    
    // 3. Version increment
    await redis.hincrby(`graph:${graphId}:state`, 'version', 1);
    
    // 4. Broadcast to all clients
    await this.broadcastUpdate(graphId, {
      type: 'COMMAND_APPLIED',
      operationId,
      result,
      version: result.version
    });
    
    // 5. Mark operation complete
    await redis.hset(`operation:${operationId}`, 'status', 'completed');
    
    return result;
  }
  
  async revertOptimistic(operationId, error) {
    // Notify client to revert optimistic update
    await this.broadcastToClient(operationId, {
      type: 'REVERT_OPTIMISTIC',
      operationId,
      error
    });
  }
}
```

### 2. Conflict Resolution Strategy

```javascript
class ConflictResolver {
  async resolveConflict(clientOp, serverState) {
    const strategy = this.getStrategy(clientOp.type);
    
    switch(strategy) {
      case 'LAST_WRITE_WINS':
        return clientOp.timestamp > serverState.lastModified 
          ? clientOp 
          : serverState;
          
      case 'MERGE':
        return this.mergeStates(clientOp, serverState);
        
      case 'CLIENT_WINS':
        return clientOp;
        
      case 'SERVER_WINS':
        return serverState;
        
      case 'MANUAL':
        await this.notifyConflict(clientOp, serverState);
        return serverState; // Keep server state until resolved
    }
  }
  
  mergeStates(clientOp, serverState) {
    // Custom merge logic based on operation type
    if (clientOp.type === 'UPDATE_NODE_POSITION') {
      // Position updates: client wins (user dragging)
      return { ...serverState, position: clientOp.position };
    }
    
    if (clientOp.type === 'UPDATE_NODE_TITLE') {
      // Title updates: detect if same base version
      if (clientOp.baseVersion === serverState.version - 1) {
        return clientOp; // No conflict
      }
      // Conflict: create merged title or prompt user
      return this.mergeTexts(clientOp.title, serverState.title);
    }
  }
}
```

### 3. Client State Reconciliation

```javascript
class StateReconciler {
  async reconcileClient(clientId, clientVersion, serverVersion) {
    if (clientVersion === serverVersion) {
      return { status: 'in_sync' };
    }
    
    if (clientVersion < serverVersion) {
      // Client behind - send updates
      const updates = await this.getUpdatesSince(clientVersion);
      return {
        status: 'behind',
        updates,
        newVersion: serverVersion
      };
    }
    
    // Client ahead (shouldn't happen) - full sync
    return {
      status: 'conflict',
      fullState: await this.getFullState(),
      newVersion: serverVersion
    };
  }
}
```

---

## 🌐 API Endpoints

### Command Endpoints (Optimistic)

```typescript
// Execute command optimistically
POST /api/v2/graphs/:graphId/command
Body: {
  operationId: string,  // Client-generated UUID
  type: CommandType,
  payload: any,
  clientVersion: number,
  timestamp: number
}
Response: {
  accepted: boolean,
  operationId: string,
  estimatedProcessingTime: number
}

// Check operation status
GET /api/v2/operations/:operationId
Response: {
  status: 'pending' | 'processing' | 'completed' | 'failed',
  result?: any,
  error?: string
}

// Batch commands
POST /api/v2/graphs/:graphId/batch
Body: {
  operations: Command[],
  atomic: boolean  // All or nothing
}
```

### Query Endpoints (Direct from Redis)

```typescript
// Get current graph state (fast read)
GET /api/v2/graphs/:graphId/state
Response: {
  version: number,
  nodes: Node[],
  edges: Edge[],
  viewport: Viewport,
  checksum: string
}

// Get changes since version
GET /api/v2/graphs/:graphId/changes?since=:version
Response: {
  changes: Change[],
  currentVersion: number
}

// Subscribe to real-time updates
WS /api/v2/graphs/:graphId/subscribe
```

---

## 🔌 WebSocket Protocol

### Connection Flow
```javascript
// 1. Client connects
ws.connect('/ws', {
  userId,
  graphId,
  clientVersion
});

// 2. Server validates and subscribes
server.on('connection', async (ws, params) => {
  const session = await createSession(params);
  await subscribeToGraph(params.graphId, ws);
  
  // Send initial sync if needed
  const syncData = await reconcileClient(params);
  ws.send({ type: 'SYNC', data: syncData });
});

// 3. Message types
const MessageTypes = {
  // Client to Server
  COMMAND: 'command',           // Optimistic command
  HEARTBEAT: 'heartbeat',        // Keep alive
  REQUEST_SYNC: 'request_sync',  // Full state sync
  
  // Server to Client  
  COMMAND_RESULT: 'command_result',  // Command processed
  STATE_UPDATE: 'state_update',      // Broadcast update
  SYNC: 'sync',                      // Full sync data
  REVERT: 'revert',                  // Revert optimistic
  CONFLICT: 'conflict'               // Conflict detected
};
```

### Real-time Broadcast System
```javascript
class BroadcastManager {
  async broadcastToGraph(graphId, message) {
    const clients = await this.getGraphClients(graphId);
    
    // Parallel broadcast with failure handling
    await Promise.allSettled(
      clients.map(client => this.sendToClient(client, message))
    );
  }
  
  async sendToClient(client, message) {
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      } else {
        await this.queueForClient(client.id, message);
      }
    } catch (error) {
      await this.handleClientError(client, error);
    }
  }
}
```

---

## 🛡️ Error Handling & Recovery

### 1. Command Failure Recovery
```javascript
class CommandRecovery {
  async handleFailedCommand(job, error) {
    const { operationId, userId, graphId } = job.data;
    
    // Log failure
    await this.logError(operationId, error);
    
    // Determine recovery strategy
    if (error.type === 'VALIDATION_ERROR') {
      // Invalid command - revert immediately
      await this.revertOptimistic(operationId, error);
    } else if (error.type === 'CONFLICT') {
      // Conflict - attempt resolution
      await this.initiateConflictResolution(operationId);
    } else if (error.type === 'TIMEOUT') {
      // Timeout - retry with backoff
      await job.retry();
    } else {
      // Unknown error - dead letter queue
      await this.moveToDeadLetter(job);
    }
  }
}
```

### 2. Connection Recovery
```javascript
class ConnectionRecovery {
  async handleDisconnect(clientId) {
    // Save client state
    await this.saveClientState(clientId);
    
    // Set grace period for reconnection
    await redis.setex(
      `client:${clientId}:disconnected`,
      300, // 5 minutes grace period
      Date.now()
    );
  }
  
  async handleReconnect(clientId, lastVersion) {
    // Check if within grace period
    const disconnectTime = await redis.get(`client:${clientId}:disconnected`);
    
    if (disconnectTime) {
      // Restore state and send missed updates
      const updates = await this.getMissedUpdates(clientId, lastVersion);
      return { type: 'RECONNECT', updates };
    } else {
      // Full resync needed
      return { type: 'FULL_SYNC', state: await this.getFullState() };
    }
  }
}
```

---

## 📊 Performance Optimizations

### 1. Redis Optimizations
```javascript
// Use pipelining for batch operations
const pipeline = redis.pipeline();
nodes.forEach(node => {
  pipeline.hset(`graph:${graphId}:nodes`, node.id, JSON.stringify(node));
});
await pipeline.exec();

// Use Lua scripts for atomic operations
const updateNodeScript = `
  local key = KEYS[1]
  local nodeId = ARGV[1]
  local nodeData = ARGV[2]
  local version = redis.call('hincrby', key..':state', 'version', 1)
  redis.call('hset', key..':nodes', nodeId, nodeData)
  return version
`;
```

### 2. Queue Optimizations
```javascript
// Batch similar operations
const batchProcessor = new BatchProcessor({
  batchSize: 100,
  maxWait: 100, // ms
  processor: async (batch) => {
    const pipeline = redis.pipeline();
    batch.forEach(op => this.addToPipeline(pipeline, op));
    return pipeline.exec();
  }
});
```

### 3. Caching Strategy
```javascript
// In-memory cache for hot data
const cache = new NodeCache({
  stdTTL: 60,      // 1 minute TTL
  checkperiod: 10,  // Check every 10 seconds
  useClones: false  // Performance: don't clone
});

// Cache graph state with version checking
async function getCachedGraph(graphId) {
  const cached = cache.get(graphId);
  if (cached) {
    // Verify version is current
    const currentVersion = await redis.hget(`graph:${graphId}:state`, 'version');
    if (cached.version === currentVersion) {
      return cached;
    }
  }
  
  // Load from Redis
  const state = await loadGraphState(graphId);
  cache.set(graphId, state);
  return state;
}
```

---

## 🚢 Deployment Architecture

### Docker Compose Setup
```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"
    
  api:
    build: .
    environment:
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=production
    ports:
      - "3000:3000"
    depends_on:
      - redis
      
  worker:
    build: .
    command: node workers/command-processor.js
    environment:
      - REDIS_URL=redis://redis:6379
      - WORKER_TYPE=commands
    depends_on:
      - redis
    scale: 3  # Run 3 workers
      
  websocket:
    build: .
    command: node websocket/server.js
    ports:
      - "8080:8080"
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

volumes:
  redis-data:
```

---

## 🔄 Migration Strategy

### Phase 1: Parallel Running (Week 1-2)
1. Deploy new backend alongside existing
2. Dual-write to both systems
3. Read from old, validate with new
4. Monitor for discrepancies

### Phase 2: Gradual Migration (Week 3-4)
1. Switch read operations to new backend
2. Maintain dual-write for safety
3. Implement fallback mechanism
4. A/B test with subset of users

### Phase 3: Full Cutover (Week 5)
1. Stop writes to old system
2. Final data migration
3. Switch all traffic to new system
4. Keep old system in read-only for reference

### Phase 4: Cleanup (Week 6)
1. Remove dual-write code
2. Optimize based on production metrics
3. Decommission old backend
4. Document lessons learned

---

## 🎯 Success Metrics

### Performance KPIs
- Command processing: < 50ms p95
- Query response: < 10ms p95
- WebSocket latency: < 100ms
- Conflict rate: < 0.1%
- Recovery success: > 99.9%

### Reliability KPIs
- Uptime: 99.95%
- Data consistency: 100%
- Message delivery: 99.99%
- Command success rate: > 99%

### User Experience KPIs
- Perceived latency: "instant" (< 100ms)
- Sync conflicts visible to user: < 1/week
- Successful optimistic updates: > 95%
- Smooth collaboration: No jarring updates

---

## 📚 Implementation Checklist

- [ ] Set up Redis cluster with persistence
- [ ] Implement BullMQ queue system
- [ ] Create command processors
- [ ] Build WebSocket server
- [ ] Implement conflict resolution
- [ ] Create reconciliation system
- [ ] Build monitoring dashboard
- [ ] Write integration tests
- [ ] Create migration scripts
- [ ] Document API changes
- [ ] Load test the system
- [ ] Implement gradual rollout