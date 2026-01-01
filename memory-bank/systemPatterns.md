# System Patterns

This file documents recurring patterns and standards used in the project.

2025-01-08 13:35:00 - Initial system patterns documentation.

## Coding Patterns

### Error Handling Pattern

**Standard approach for all async operations:**

```javascript
try {
  const result = await operation();
  console.log('✅ Operation successful:', result);
  return result;
} catch (error) {
  console.error('❌ Operation failed:', error.message);
  return null; // or throw, depending on context
}
```

**Used in:**
- Redis operations (`src/redis.js`)
- WebSocket message handling (`src/simple-server.js`)
- API endpoints (all REST routes)

### Logging Pattern

**Console logging with emoji indicators:**

```javascript
console.log('✅ Success message');
console.error('❌ Error message');
console.log('📡 Network operation');
console.log('📊 Data/analytics operation');
console.log('🔄 Retry/reconnect operation');
console.log('⚠️  Warning message');
```

**Rationale**: Quick visual scanning of logs, easier debugging

### Retry Strategy Pattern

**Exponential backoff with max attempts:**

```javascript
retryStrategy: (times) => {
  if (times > MAX_RETRIES) {
    console.error('❌ Retry limit reached');
    return null; // Stop retrying
  }
  const delay = Math.min(times * BASE_DELAY, MAX_DELAY);
  console.log(`🔄 Retry attempt ${times}, waiting ${delay}ms`);
  return delay;
}
```

**Used in:**
- Redis connection (`src/redis.js`)
- WebSocket reconnection (client-side)

## Architectural Patterns

### Optimistic UI Flow

**Pattern:**
```
1. Client applies change locally (immediate UI update)
2. Client sends operation to server via WebSocket
3. Server validates and persists to Redis
4. Server broadcasts confirmed operation to all clients
5. Clients apply server's authoritative update
```

**Conflict Resolution:**
- Server version always wins
- Client reconciles on mismatch (rare)
- Version numbers track state changes

**Implementation:**
- Frontend: Apply to store immediately
- Backend: `applyOperation()` function in `src/simple-server.js`
- Broadcast: `OPERATION_APPLIED` message to all subscribed clients

### WebSocket Message Protocol

**Client → Server:**
```javascript
{
  type: 'SUBSCRIBE' | 'OPERATION' | 'SYNC' | 'PING',
  graphId: 'string',      // For SUBSCRIBE
  userId: 'string',       // For SUBSCRIBE
  payload: {              // For OPERATION
    type: 'ADD_NODE' | 'UPDATE_NODE' | 'DELETE_NODE' | ...,
    payload: { /* operation-specific data */ }
  }
}
```

**Server → Client:**
```javascript
{
  type: 'CONNECTION_ESTABLISHED' | 'GRAPH_STATE' | 'OPERATION_APPLIED' | 'ERROR',
  clientId: number,       // For CONNECTION_ESTABLISHED
  payload: { },          // Graph data or operation
  userId: 'string',       // User who made change
  timestamp: number       // When operation occurred
}
```

### Redis Data Organization

**Key Patterns:**

```
user:{userId}:graph:{graphId}              # Graph data
history:{userId}:{graphId}:{timestamp}      # Undo/redo history (TTL: 1h)
operations:{graphId}                        # Recent operations (100 max)
analytics:events:{userId}:{graphId}         # Redis Stream for events
analytics:aggregates:{userId}:{graphId}     # Pre-calculated metrics
snapshots:{userId}:{graphId}:{nodeId}:{date} # Daily progress snapshots
```

**Rationale**: Namespaced keys prevent collisions, easy to query/delete

### Recursive Node Operations

**Pattern for hierarchical updates:**

```javascript
function updateNodeRecursive(nodes) {
  for (let node of nodes) {
    if (node.id === targetId) {
      // Apply update
      Object.assign(node, updates);
      return true;
    }
    if (node.children && node.children.length > 0) {
      if (updateNodeRecursive(node.children)) return true;
    }
  }
  return false;
}
```

**Used for:**
- Finding nodes by ID
- Updating node properties
- Deleting nodes from hierarchy
- Calculating aggregate progress

## Testing Patterns

### Health Check Pattern

**Standard health check response:**

```javascript
{
  status: 'healthy' | 'degraded' | 'unhealthy',
  redis: boolean,           // Redis connection status
  websocket: number,        // Connected clients count
  timestamp: string,        // ISO timestamp
  version: string,          // Optional: app version
  uptime: number           // Optional: seconds since start
}
```

**Endpoint**: `GET /health`

**Used by:**
- Monitoring services
- Load balancers
- Deployment health checks

### Debug Script Pattern

**Standalone debugging scripts:**

```javascript
// check-something.js
import redis from './src/redis.js';

async function debug() {
  console.log('🔍 Checking...');
  const data = await redis.get('key');
  console.log('📊 Result:', data);
  process.exit(0);
}

debug();
```

**Examples:**
- `check-snapshots.js`
- `debug-redis.js`
- `test-comparison-debug.js`

## Configuration Patterns

### Environment Variable Hierarchy

**Priority order:**
```
1. Process environment variables (highest)
2. .env file (development)
3. Default fallback values (lowest)
```

**Example:**
```javascript
const redisHost = process.env.REDISHOST || 
                  process.env.REDIS_HOST || 
                  'localhost';
```

### Multi-Environment Support

**Pattern:**
```javascript
if (process.env.NODE_ENV === 'production') {
  // Production config
} else {
  // Development config
}
```

**Railway Production:**
- Uses `REDIS_PRIVATE_URL` for internal network
- Auto-configured `PORT` variable
- IPv6 networking with `family: 0`

**Local Development:**
- Docker Compose Redis at `localhost:6379`
- Fixed port `3001`
- IPv4 networking

## API Design Patterns

### REST Endpoint Structure

**Standard response format:**

```javascript
// Success
{
  success: true,
  data: { },           // Actual response data
  version: number     // Optional: for versioning
}

// Error
{
  success: false,
  error: 'Error message',
  code: 'ERROR_CODE'  // Optional: for client handling
}
```

### Context-Aware Filtering

**Query parameter pattern:**

```
GET /api/analytics/:graphId?context=nodeId
```

**Purpose**: Filter analytics to specific breadcrumb context

**Implementation:**
- If `context` provided, filter to that node's subtree
- If not provided, show all nodes
- Used in analytics dashboard

## Performance Patterns

### Pre-calculated Aggregates

**Pattern:**
```javascript
// On every progress update, update aggregates
await redis.hset(
  `analytics:aggregates:${userId}:${graphId}`,
  'completedCount', count,
  'averageProgress', average,
  'lastUpdate', timestamp
);
```

**Benefits:**
- Dashboard loads instantly (no calculation)
- Consistent view across clients
- Scalable to large graphs

### Connection Pooling

**ioredis built-in connection management:**

```javascript
const redis = new Redis(config);
// Reuse single connection
// ioredis handles connection pool internally
```

**Benefits:**
- No connection overhead per operation
- Automatic reconnection
- Connection state management

## Security Patterns

### CORS Configuration

**Environment-based CORS:**

```javascript
const corsOrigins = process.env.CORS_ORIGINS?.split(',') || 
                   ['http://localhost:3000'];

app.use(cors({
  origin: corsOrigins,
  credentials: true
}));
```

**Production**: Whitelist specific domains
**Development**: Allow localhost with various ports

### User ID Validation

**Pattern (to be implemented):**

```javascript
function validateUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid user ID');
  }
  return userId;
}
```

**Current State**: Basic validation, no authentication yet
**Future**: Add JWT or session-based auth

## Deployment Patterns

### Railway Auto-Deploy

**Git-based deployment:**
```bash
git push origin main → Railway detects → Auto-build → Deploy
```

**Configuration:**
- `railway.json` for build settings
- `Procfile` for start command
- Environment variables in Railway dashboard

### Health Check for Zero-Downtime

**Pattern:**
```javascript
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});
```

**Used by:**
- Railway to determine service health
- Load balancers for routing decisions
- Monitoring for alerting

### Environment-Specific Behavior

**Pattern:**
```javascript
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  // Stricter error handling
  // No debug logs
  // Use production URLs
} else {
  // Verbose logging
  // Mock data for testing
  // Local services
}
```

## Code Organization Patterns

### Feature-Based Modules

**Pattern:**
```
src/
  simple-server.js     # Main server + WebSocket
  redis.js            # Redis client + utilities
  analytics-v2.js     # Analytics service
  progress-snapshots.js # Snapshot functionality
```

**Benefits:**
- Clear responsibilities
- Easy to find code
- Testable in isolation

### Separation of Concerns

**Layers:**
```
Presentation: WebSocket/REST handlers
Business Logic: applyOperation(), analytics calculations
Data Access: Redis get/set/stream operations
```

**Example:**
- WebSocket receives message
- Calls `applyOperation()` (business logic)
- Which calls Redis operations (data layer)
- Result broadcast via WebSocket (presentation)