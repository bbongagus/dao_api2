# Optimistic UI Backend

Real-time collaborative graph editing backend with WebSocket synchronization and Redis persistence.

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for local development)

### Installation

1. Clone and navigate to the project:
```bash
cd dao_api2
```

2. Set up environment:
```bash
cp .env.example .env
```

3. Start with Docker. The container runs under `NODE_ENV=production` and trusts
   Auth0 only, so `.env` needs `AUTH0_DOMAIN` and `AUTH_AUDIENCE`:
```bash
docker-compose up -d
```

The backend will be available at:
- WebSocket: `ws://localhost:3001`
- REST API: `http://localhost:3001/api`
- Redis: `localhost:6379`

### Verify Installation
```bash
# Check containers
docker ps

# View logs
docker logs optimistic-backend

# Test health endpoint
curl http://localhost:3001/health
```

## Development

### Local Development
```bash
# Install dependencies
npm install

# Once: a local key pair and AUTH_AUDIENCE in .env — the server does not start without them
npm run auth:dev-keys

# Run locally (requires Redis); reads .env
npm run dev

# A token for a user, for scripts and graphy's VITE_DEV_TOKEN
npm run -s token -- dev-user-1
```

Every `/api` request and every WebSocket subscription carries a token; see
[AUTHENTICATION.md](./AUTHENTICATION.md).

### Docker Development
```bash
# Build and run
docker-compose up --build

# Restart after changes
docker-compose restart optimistic-backend

# View logs
docker-compose logs -f optimistic-backend
```

## Usage

### WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:3001');

ws.on('open', () => {
  // Subscribe to graph; the token says who is asking
  ws.send(JSON.stringify({
    type: 'SUBSCRIBE',
    graphId: 'main',
    token: '<jwt>'
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  // Handle GRAPH_STATE, OPERATION_APPLIED, etc.
});
```

### REST API
```javascript
// Load graph
fetch('http://localhost:3001/api/graphs/main', {
  headers: { Authorization: `Bearer ${token}` }
})
  .then(res => res.json())
  .then(data => console.log(data.graph));

// Save graph
fetch('http://localhost:3001/api/graphs/main', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ nodes: [], edges: [] })
});
```

## Operations

### Supported Operations
- `ADD_NODE` - Add new node (with parent support)
- `UPDATE_NODE` - Update node properties
- `DELETE_NODE` - Remove node and its connections
- `ADD_EDGE` - Create edge between nodes
- `DELETE_EDGE` - Remove edge
- `UPDATE_VIEWPORT` - Update viewport state

### Operation Format
```json
{
  "type": "OPERATION",
  "payload": {
    "type": "UPDATE_NODE",
    "payload": {
      "id": "node-id",
      "nodeId": "node-id",
      "updates": {
        "isDone": true,
        "currentCompletions": 1
      }
    }
  }
}
```

## Features

- ✅ **Real-time Synchronization** - All changes instantly reflected across clients
- ✅ **Optimistic Updates** - Immediate UI response with server confirmation
- ✅ **Hierarchy Support** - Parent-child relationships preserved
- ✅ **Progress Tracking** - isDone states and completion counts
- ✅ **Daily Reset** - Automatic progress reset (configurable)
- ✅ **Multi-tab Support** - Synchronized across browser tabs
- ✅ **Auto-reconnection** - Resilient WebSocket connections
- ✅ **Docker Ready** - Production-ready containerization

## Debugging

### View Redis Data
```bash
# Connect to Redis
docker exec -it optimistic-redis redis-cli

# Get graph data
GET graph:main

# Clear all data
FLUSHALL
```

### Monitor WebSocket Traffic
```bash
# View real-time logs
docker logs -f optimistic-backend | grep -E "ADD_NODE|UPDATE_NODE|DELETE_NODE"
```

### Common Issues

**Connection refused:**
- Check Docker containers are running: `docker ps`
- Verify ports are not in use: `lsof -i :3001`

**Data not persisting:**
- Check Redis is running: `docker exec optimistic-redis redis-cli ping`
- View Redis logs: `docker logs optimistic-redis`

**Updates not syncing:**
- Check WebSocket connection in browser console
- Verify SUBSCRIBE message was sent
- Check for CORS issues if frontend on different port

## 🚂 Production Deployment

### Railway Deployment (Recommended)

Deploy to Railway in minutes with full WebSocket and Redis support:

1. **Create Railway Account**: [railway.app](https://railway.app)
2. **Deploy from GitHub**: Connect your repository
3. **Add Redis**: One-click Redis database
4. **Configure**: Set environment variables (automatic for Redis)
5. **Done!**: Your API is live with WebSocket support

📚 **Full Guide**: See [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) for detailed instructions.

**Key Benefits:**
- ✅ Full WebSocket support
- ✅ Built-in Redis database
- ✅ Auto-deploy from GitHub
- ✅ Free $5/month credits
- ✅ Custom domains
- ✅ Automatic HTTPS

**Quick Deploy:**
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway link
railway up
```

**Environment Variables:**
```bash
NODE_ENV=production
CORS_ORIGINS=https://your-frontend.vercel.app
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH_AUDIENCE=https://dao-api
# REDIS_URL and PORT are set automatically by Railway
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design, and
[AUTHENTICATION.md](./AUTHENTICATION.md) for who may read and write a graph.

## License

MIT