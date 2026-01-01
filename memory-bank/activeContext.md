# Active Context

This file tracks the project's current status, including recent changes, current goals, and open questions.

2025-01-08 13:32:00 - Memory Bank initialized after Railway deployment completion.

## Current Focus

### ✅ Railway Deployment - COMPLETED
Successfully deployed backend to Railway with full WebSocket and Redis support.

**Status**: Production ready and running
**URL**: Railway auto-generated (e.g., `https://dao-api2-production.up.railway.app`)

### Key Achievement: IPv6 Fix
Resolved Redis connection issue by adding `family: 0` option to ioredis configuration, enabling proper IPv6 DNS resolution for `redis.railway.internal`.

## Recent Changes

### 2025-01-08: Railway Deployment Completed

**Files Created:**
- [`railway.json`](../railway.json) - Railway platform configuration
- [`Procfile`](../Procfile) - Startup command for Railway
- [`RAILWAY_DEPLOYMENT.md`](../RAILWAY_DEPLOYMENT.md) - Complete deployment guide (450+ lines)
- [`QUICK_DEPLOY.md`](../QUICK_DEPLOY.md) - 5-minute quick start guide  
- [`RAILWAY_REDIS_VARIABLES.md`](../RAILWAY_REDIS_VARIABLES.md) - Redis configuration guide

**Files Modified:**
- [`.gitignore`](../.gitignore) - Added Railway, Vercel, and production patterns
- [`src/redis.js`](../src/redis.js) - **Critical fix**: Added `family: 0` for IPv6 support
- [`.env.example`](../.env.example) - Added Railway environment variables
- [`README.md`](../README.md) - Added Railway deployment section

**Key Code Change:**
```javascript
// src/redis.js - IPv6 support added
const commonOptions = {
  family: 0,  // 0 = auto-detect IPv4/IPv6
  retryStrategy: (times) => {
    if (times > 10) return null;
    return Math.min(times * 100, 2000);
  },
  maxRetriesPerRequest: 3,
  connectTimeout: 10000
};
```

### Problem Solved: Redis DNS Resolution

**Issue**: `getaddrinfo ENOTFOUND redis.railway.internal`
**Root Cause**: Railway uses IPv6 for internal networking, ioredis defaulted to IPv4
**Solution**: Set `family: 0` to enable auto-detection of IPv4/IPv6
**Result**: Redis successfully connects via Railway's internal network

### Deployment Configuration

**Railway Environment Variables:**
```bash
# Auto-set by Railway:
REDISHOST = ${{Redis.REDISHOST}}
REDISPORT = ${{Redis.REDISPORT}}
REDISPASSWORD = ${{Redis.REDISPASSWORD}}
PORT = (dynamic)

# User-configured:
NODE_ENV = production
CORS_ORIGINS = https://your-frontend.vercel.app
```

**Benefits Achieved:**
- ✅ Full WebSocket support (not possible on Vercel)
- ✅ Integrated Redis database
- ✅ Auto-deploy from GitHub
- ✅ Free internal network (no egress charges)
- ✅ HTTPS/WSS automatic
- ✅ $5/month free credits

## Open Questions/Issues

### None Currently

All major deployment issues have been resolved. The system is production-ready.

### Potential Future Considerations

1. **Custom Domain**: Currently using Railway's auto-generated domain
   - Consider adding custom domain for production
   - Update CORS_ORIGINS accordingly

2. **Monitoring**: Basic health check exists
   - Could add more comprehensive monitoring (Sentry, etc.)
   - Consider adding performance metrics

3. **Scaling**: Currently single instance
   - Railway supports horizontal scaling if needed
   - Redis should handle increased load

4. **Backup Strategy**: Redis data persistence
   - Railway provides Redis backups
   - Consider additional backup mechanisms for critical data

5. **Frontend Integration**: 
   - Frontend needs to be updated with Railway WebSocket URL
   - `const WS_URL = 'wss://your-app.up.railway.app'`
   - `const API_URL = 'https://your-app.up.railway.app'`

## Next Steps (Optional Enhancements)

### Short Term
- [ ] Test production deployment with frontend
- [ ] Monitor Railway usage and costs
- [ ] Set up alerts for downtime

### Medium Term  
- [ ] Add custom domain
- [ ] Implement comprehensive monitoring
- [ ] Set up staging environment

### Long Term
- [ ] Consider CDN for static assets
- [ ] Implement rate limiting
- [ ] Add API authentication
- [ ] Team collaboration features

## Development Workflow

**Current Setup:**
- **Development**: Docker Compose locally (`docker-compose up`)
- **Production**: Railway auto-deploy from `main` branch
- **Testing**: Local with `npm run dev`

**Git Workflow:**
```bash
git add .
git commit -m "feature: description"
git push origin main  # Triggers Railway auto-deploy
```

## File Organization Notes

**Deployment Documentation:**
- Primary guide: `RAILWAY_DEPLOYMENT.md` (comprehensive)
- Quick start: `QUICK_DEPLOY.md` (5 minutes)
- Troubleshooting: `RAILWAY_REDIS_VARIABLES.md`

**Core Application:**
- Main server: `src/simple-server.js`
- Redis client: `src/redis.js` (with IPv6 fix)
- Analytics: `src/analytics-v2.js` (simplified)

**Configuration:**
- Railway: `railway.json`, `Procfile`
- Docker: `docker-compose.yml`, `Dockerfile`
- Environment: `.env.example` (template)

## Recent Code Changes (2025-01-09)

### Added Diagnostic Logging for linkedNodeIds

**Files Modified:**
- [`src/simple-server.js`](../src/simple-server.js) - Lines 233-241, 329-346

**Changes:**
1. **ADD_NODE operation** - Added logging for linkedNodeIds:
   ```javascript
   // Log linkedNodeIds status when adding nodes
   const linkedIdsCount = Object.keys(newNode.linkedNodeIds).length;
   if (linkedIdsCount > 0) {
     console.log(`  🔗 Node has ${linkedIdsCount} linkedNodeIds connection types`);
     Object.entries(newNode.linkedNodeIds).forEach(([type, ids]) => {
       console.log(`     ${type}: [${ids.join(', ')}]`);
     });
   }
   ```

2. **UPDATE_NODE operation** - Added logging for linkedNodeIds updates:
   ```javascript
   // Log linkedNodeIds updates
   if (payload.updates.linkedNodeIds !== undefined) {
     node.linkedNodeIds = payload.updates.linkedNodeIds;
     console.log(`    🔗 Updated linkedNodeIds: ${linkedIdsCount} connection types`);
     // ... detailed logging
   }
   ```

3. **UPDATE_NODE with children** - Check children for linkedNodeIds:
   ```javascript
   const childrenWithLinks = node.children.filter(
     c => c.linkedNodeIds && Object.keys(c.linkedNodeIds).length > 0
   );
   if (childrenWithLinks.length > 0) {
     console.log(`    🔗 ${childrenWithLinks.length} children have linkedNodeIds`);
   }
   ```

**Purpose:** 
- Debug and track node relationships through linkedNodeIds
- Monitor connection types between nodes
- Identify issues with node linking in the graph

**Impact:** 
- Better visibility into node relationships
- Easier debugging of complex graph structures
- No performance impact (console logs only)

### Identified: User Isolation Warning

**Issue Found (Line 632-637):**
```javascript
if (!data.userId) {
  console.error(`⚠️  Client ${clientId} SUBSCRIBE without userId!`);
  console.error(`   This will cause user isolation failure - all users share same graph!`);
}
```

**Current Behavior:**
- If frontend doesn't send `userId` in SUBSCRIBE message
- Backend defaults to `DEFAULT_USER_ID = '1'`
- **All users would share the same graph data**

**Risk:** High - User data isolation could be compromised

**Resolution Needed:**
- Frontend must always send `userId` in SUBSCRIBE
- Consider making `userId` required (reject connection if missing)
- Add user authentication layer in future

**Status:** Logged warning exists, frontend integration needed