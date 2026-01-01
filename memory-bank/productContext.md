# Product Context

## Project Overview

**DAO Optimistic UI Backend** - Real-time collaborative graph editing backend with WebSocket synchronization and Redis persistence. This is a production-ready backend for a task/goal management system with Figma/Miro-style optimistic UI.

2025-01-08 13:31:00 - Initial Memory Bank creation based on project documentation and Railway deployment completion.

## Project Goal

Build a high-performance, real-time backend that supports:
- **Optimistic UI pattern** - Instant local updates with server confirmation
- **Real-time collaboration** - Multi-tab and multi-user synchronization via WebSocket
- **Hierarchical data** - Parent-child task relationships
- **Progress tracking** - Task completion with daily reset functionality
- **Analytics** - Simplified progress-focused metrics
- **Production deployment** - Railway hosting with IPv6 support

## Key Features

### Core Functionality
- **WebSocket Real-time Sync** - Instant updates across all connected clients
- **Redis Single Source of Truth** - All graph data persisted in Redis
- **Hierarchical Node System** - Supports parent-child relationships
- **Progress Tracking** - `isDone`, completion counts, calculated progress
- **Daily Reset Logic** - Configurable automatic progress resets
- **Multi-tab Support** - Synchronized state across browser tabs
- **Optimistic Updates** - Client-side immediate updates with server confirmation

### Analytics (Simplified)
- Progress-only tracking (removed session/time tracking)
- Category-based metrics (fundamental nodes)
- Real-time aggregates in Redis
- Context-aware filtering (by breadcrumb navigation)
- "All time" period focus (MVP)

### Production Ready
- **Docker containerization** - Easy local development
- **Railway deployment** - Production hosting with WebSocket support
- **IPv6 networking** - Proper Railway internal network support
- **Health check endpoint** - Monitoring and uptime checks
- **Auto-deploy** - GitHub integration for continuous deployment

## Overall Architecture

### Technology Stack
- **Runtime**: Node.js 18+
- **Server**: Express + WebSocket (ws library)
- **Database**: Redis (ioredis client)
- **Deployment**: Railway (with Docker support)
- **Real-time**: WebSocket protocol for bidirectional communication

### System Components

```
┌──────────────────────┐
│   Frontend (Graphy)  │
│   React + Zustand    │
└──────────┬───────────┘
           │
           │ WebSocket + REST
           │
┌──────────▼───────────┐
│   Backend Server     │
│   Express + WS       │
│   src/simple-server  │
└──────────┬───────────┘
           │
           │ ioredis
           │
┌──────────▼───────────┐
│   Redis Database     │
│   - Graph Data       │
│   - Analytics Events │
│   - Progress Snaps   │
└──────────────────────┘
```

### Data Model

**Graph Structure:**
```javascript
{
  nodes: [
    {
      id: "uuid",
      title: "Task Name",
      nodeType: "dao" | "fundamental",
      nodeSubtype: "simple" | "withChildren" | "category",
      isDone: false,
      currentCompletions: 0,
      requiredCompletions: 1,
      calculatedProgress: 0,
      position: { x, y },
      children: []
    }
  ],
  edges: [],
  viewport: { x, y, zoom },
  settings: {
    resetProgressEnabled: true,
    resetFrequency: "daily",
    lastProgressReset: "ISO timestamp"
  },
  version: 1,
  userId: "user-id"
}
```

### Communication Protocol

**WebSocket Messages:**
- `SUBSCRIBE` - Join graph channel
- `OPERATION` - Execute ADD_NODE, UPDATE_NODE, DELETE_NODE, etc.
- `GRAPH_STATE` - Initial state on connection
- `OPERATION_APPLIED` - Broadcast confirmed operations
- `SYNC` - Force state synchronization

**REST Endpoints:**
- `GET /api/graphs/:graphId` - Load graph
- `POST /api/graphs/:graphId` - Save graph
- `GET /api/analytics/:graphId` - Get analytics
- `GET /api/analytics/categories/:graphId` - Category metrics
- `GET /health` - Health check

### Deployment Architecture

**Production (Railway):**
```
┌─────────────────────┐
│  Railway Project    │
├─────────────────────┤
│  Backend Service    │
│  - Auto-deploy      │
│  - WebSocket ✅     │
│  - IPv6 support ✅  │
│  - Port: Dynamic    │
└──────────┬──────────┘
           │
           │ Private Network
           │
┌──────────▼──────────┐
│  Redis Service      │
│  - Managed          │
│  - Internal DNS     │
│  - IPv6 ready       │
└─────────────────────┘
```

**Local Development (Docker):**
```
docker-compose.yml:
  - optimistic-backend (port 3001)
  - optimistic-redis (port 6379)
```

## Recent Major Updates

### 2025-01-08: Railway Deployment Implementation
- Configured project for Railway hosting
- Fixed IPv6 networking issues with `family: 0` option
- Created comprehensive deployment documentation
- Added Railway-specific Redis configuration
- Updated `.gitignore` for production deployment

### 2024: Analytics Refactoring
- Removed complex session tracking
- Simplified to progress-only metrics
- Implemented real-time aggregates
- Added context-aware filtering
- Created AdaptiveDashboard components

### 2024: Core System
- Initial optimistic UI implementation
- WebSocket real-time synchronization
- Redis persistence layer
- Docker containerization
- Progress tracking and daily reset

## Target Users

- Individual users managing personal goals/tasks
- Teams collaborating on projects
- Anyone needing hierarchical task management
- Users requiring real-time multi-device sync

## Success Metrics

- **Latency**: < 50ms for local operations
- **Real-time**: Instant sync across all tabs
- **Reliability**: 99.9% uptime on Railway
- **Performance**: Support 1000+ concurrent connections
- **Data Integrity**: Zero data loss with Redis persistence