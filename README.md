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

3. Start with Docker:
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

# Run locally (requires Redis)
npm start
```

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
  // Subscribe to graph
  ws.send(JSON.stringify({
    type: 'SUBSCRIBE',
    graphId: 'main',
    userId: 'user1'
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
fetch('http://localhost:3001/api/graphs/main')
  .then(res => res.json())
  .then(data => console.log(data.graph));

// Save graph
fetch('http://localhost:3001/api/graphs/main', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
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

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design.

## License

MIT