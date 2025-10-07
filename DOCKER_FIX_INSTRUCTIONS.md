# Docker Configuration Fix for ES6 Modules

## Changes Made

### 1. Dockerfile Updates
- Added `curl` installation for healthcheck support
- Fixed port exposure (now uses 3001 to match docker-compose)
- Removed npm start in favor of direct node execution
- Added comment about ES6 modules support via package.json

### 2. Docker-compose.yml Updates
- Added version specification (3.8)
- Added network configuration for better container communication
- Added build context specification
- Added optional volume mounts for development
- Fixed service dependencies

### 3. Package.json
- Already has `"type": "module"` for ES6 support
- All dependencies (cron, node-fetch) are included

## How to Run

### 1. Stop existing containers
```bash
docker-compose down
```

### 2. Rebuild the images with new configuration
```bash
docker-compose build --no-cache
```

### 3. Start services
```bash
docker-compose up -d
```

### 4. Check logs to ensure everything started correctly
```bash
docker-compose logs -f backend
```

### 5. Test the endpoints

#### Health check:
```bash
curl http://localhost:3001/health
```

#### Test snapshot creation:
```bash
curl -X POST http://localhost:3001/api/analytics/snapshot \
  -H "Content-Type: application/json" \
  -d '{"nodeId": "test-node-1"}'
```

#### Test progress comparison:
```bash
curl "http://localhost:3001/api/analytics/progress-comparison?nodeIds=test-node-1&period=30"
```

## Verify ES6 Modules are Working

Check the logs for:
1. No syntax errors related to `import/export`
2. CronJob initialization message
3. WebSocket server startup
4. Redis connection success

## Troubleshooting

### If you still see ECONNREFUSED:
1. Check if Redis is running:
```bash
docker-compose ps
```

2. Verify Redis is healthy:
```bash
docker-compose exec redis redis-cli ping
```

3. Check network connectivity:
```bash
docker-compose exec backend ping redis
```

### If ES6 modules fail:
1. Verify Node.js version in container:
```bash
docker-compose exec backend node --version
```
Should be 18.x or higher

2. Check package.json is correctly mounted:
```bash
docker-compose exec backend cat package.json | grep type
```
Should show `"type": "module"`

### If CronJob doesn't work:
Check logs for cron initialization:
```bash
docker-compose logs backend | grep -i cron
```

## Clean Restart Procedure

If issues persist, do a complete clean restart:

```bash
# Stop all containers
docker-compose down -v

# Remove old images
docker rmi optimistic-backend:latest

# Rebuild from scratch
docker-compose build --no-cache

# Start fresh
docker-compose up -d

# Watch logs
docker-compose logs -f
```

## Expected Log Output

When everything is working correctly, you should see:
```
optimistic-backend | [2024-12-29T15:00:00.000Z] Redis connected successfully
optimistic-backend | [2024-12-29T15:00:00.001Z] WebSocket server started on port 3001
optimistic-backend | [2024-12-29T15:00:00.002Z] Daily snapshot cron job initialized - will run at midnight
optimistic-backend | [2024-12-29T15:00:00.003Z] Server running on http://localhost:3001