# Decision Log

This file records architectural and implementation decisions using a list format.

2025-01-08 13:34:00 - Initial decision log created documenting Railway deployment decisions.

## Decision

**Deploy to Railway instead of Vercel** (2025-01-08)

## Rationale

1. **WebSocket Requirement**: Vercel serverless functions don't support WebSocket connections
2. **Redis Integration**: Railway provides integrated Redis in same project
3. **Internal Networking**: Free communication between services in Railway project
4. **Simpler Architecture**: No need for hybrid deployment (API on Vercel, WS on another platform)
5. **Cost-Effective**: $5/month free credits, internal network free
6. **Developer Experience**: Auto-deploy from GitHub, simple configuration

## Implementation Details

- Created `railway.json` for platform configuration
- Created `Procfile` to specify startup command
- Used Railway's built-in Redis service
- Configured environment variables as References (`${{Redis.REDISHOST}}`)

---

## Decision

**Use IPv6 auto-detection in ioredis** (2025-01-08)

## Rationale

1. **Railway Network**: Railway uses IPv6 for internal service networking
2. **DNS Resolution**: `redis.railway.internal` requires IPv6 DNS lookups
3. **Compatibility**: `family: 0` provides both IPv4 and IPv6 support
4. **Reliability**: Auto-detection more robust than hardcoding protocol version
5. **Future-Proof**: Works in both local (IPv4) and Railway (IPv6) environments

## Implementation Details

```javascript
// src/redis.js
const commonOptions = {
  family: 0,  // 0 = auto-detect, 4 = IPv4 only, 6 = IPv6 only
  retryStrategy: (times) => {
    if (times > 10) return null;
    return Math.min(times * 100, 2000);
  },
  maxRetriesPerRequest: 3,
  connectTimeout: 10000
};
```

**Impact**: Resolved `ENOTFOUND redis.railway.internal` error completely

---

## Decision

**Use individual Redis environment variables over URL** (2025-01-08)

## Rationale

1. **Reliability**: REDISHOST/REDISPORT/REDISPASSWORD more reliable than parsing URL
2. **Railway Compatibility**: Individual variables work better with internal networking
3. **Fallback Strategy**: Can try URL if individual params not available
4. **Clarity**: More explicit than parsing connection strings
5. **Debugging**: Easier to verify individual components

## Implementation Details

Priority order in `src/redis.js`:
1. Individual params (REDISHOST, REDISPORT, REDISPASSWORD)
2. URL formats (REDIS_URL, REDIS_PRIVATE_URL)
3. Localhost fallback for development

---

## Decision

**Simplified analytics to progress-only tracking** (2024)

## Rationale

1. **Complexity Reduction**: Session tracking was overly complex
2. **User Value**: Progress completion is most meaningful metric
3. **Performance**: Pre-calculated aggregates in Redis faster than real-time computation
4. **Maintainability**: Simpler code, easier to understand and modify
5. **Accuracy**: No need to track time, which was often inaccurate

## Implementation Details

- Removed session duration tracking
- Removed focus time calculations
- Kept only progress percentage, completion status, category breakdown
- Implemented Redis Stream for event history
- Added real-time aggregates for dashboard

---

## Decision

**Use WebSocket for real-time sync instead of polling** (2024)

## Rationale

1. **Latency**: WebSocket provides <50ms updates vs polling's seconds
2. **Efficiency**: Bi-directional communication, no repeated HTTP overhead
3. **Battery**: Mobile-friendly, no constant polling drain
4. **User Experience**: Instant updates feel more responsive
5. **Industry Standard**: Figma, Miro, etc. all use WebSocket

## Implementation Details

- Used `ws` library for WebSocket server
- Implemented SUBSCRIBE/OPERATION protocol
- Broadcast system for multi-client sync
- Automatic reconnection with state recovery
- Fallback to REST API if WebSocket unavailable

---

## Decision

**Redis as single source of truth** (2024)

## Rationale

1. **Simplicity**: No need for complex database
2. **Performance**: In-memory = extremely fast reads/writes
3. **Persistence**: Redis supports data persistence (RDB/AOF)
4. **Real-time**: Natural fit for real-time applications
5. **Scalability**: Can add Redis Cluster later if needed

## Implementation Details

- Store complete graph state as JSON
- Version numbers for conflict resolution
- Redis Streams for analytics events
- TTL for temporary data (history, cache)
- Backup through Railway's managed Redis

---

## Decision

**Docker for local development** (2024)

## Rationale

1. **Consistency**: Same environment for all developers
2. **Simplicity**: Single `docker-compose up` command
3. **Isolation**: No conflicts with system-installed services
4. **Redis Included**: Don't need to install Redis locally
5. **Production Parity**: Similar to Railway environment

## Implementation Details

- `docker-compose.yml` with backend and Redis services
- Volume mounting for live reload during development
- Port mapping for easy access (3001, 6379)
- Separate Dockerfile for production builds

---

## Decision

**Hierarchical node system with children array** (2024)

## Rationale

1. **Natural Structure**: Tasks often have subtasks
2. **Visual Representation**: Tree structure clear in UI
3. **Performance**: No need for complex edge queries
4. **Flexibility**: Can have arbitrary nesting depth
5. **Simplicity**: Parent-child relationship explicit

## Implementation Details

```javascript
{
  id: "parent-id",
  title: "Parent Task",
  children: [
    { id: "child-1", title: "Subtask 1", children: [] },
    { id: "child-2", title: "Subtask 2", children: [] }
  ]
}
```

- Recursive operations for nested updates
- Auto-update parent subtype when children added
- Progress calculation bubbles up from leaves

---

## Decision

**Optimistic UI pattern for instant feedback** (2024)

## Rationale

1. **User Experience**: Feels instant, no waiting for server
2. **Industry Standard**: Used by Figma, Notion, Linear, etc.
3. **Resilience**: Can work offline temporarily
4. **Confidence**: Server validates, client trusts initially
5. **Performance Perception**: App feels faster than it is

## Implementation Details

- Client applies update immediately
- Send operation to server via WebSocket
- Server validates and persists
- Server broadcasts confirmed operation
- Client reconciles if conflict (rare)

---

## Decision

**Use Reference variables in Railway instead of copying values** (2025-01-08)

## Rationale

1. **Dynamic Updates**: If Redis restarts, URL auto-updates
2. **Security**: Values not exposed in plaintext in UI
3. **Railway Best Practice**: Recommended by platform
4. **Service Linking**: Explicit connection between services
5. **Mistake Prevention**: Can't accidentally use wrong URL

## Implementation Details

Format: `${{ServiceName.VARIABLE_NAME}}`
Example: `REDISHOST = ${{Redis.REDISHOST}}`

Don't copy actual values like `redis://default:password@redis.railway.internal:6379`