# Analytics System Refactoring Documentation

## Overview
Complete refactoring of the analytics system to focus only on progress tracking, removing unnecessary session management and simplifying the architecture.

## Key Changes

### 1. Backend Changes

#### New Analytics Service (`analytics-v2.js`)
- **Removed**: Session tracking, time spent calculations, focus time
- **Added**: Simple progress event tracking with aggregates
- **Focus**: Only track progress updates when nodes change state

#### Key Features:
- Event stream using Redis Streams for history
- Real-time aggregates in Redis
- Context-aware filtering (breadcrumb support)
- Completed nodes list with timestamps

#### Data Structure:
```javascript
// Progress Event
{
  timestamp: number,
  userId: string,
  graphId: string,
  nodeId: string,
  nodePath: string[],
  nodeTitle: string,
  nodeType: 'dao' | 'fundamental',
  categoryId: string,
  categoryName: string,
  previousProgress: number,
  currentProgress: number,
  isDone: boolean,
  currentCompletions: number,
  requiredCompletions: number
}

// Aggregates
{
  completedNodes: [...],      // List of completed nodes
  categoryProgress: [...],    // Progress by category
  distribution: {...},        // Percentage distribution
  totalNodes: number,
  completedCount: number,
  averageProgress: number
}
```

### 2. WebSocket Integration

#### Progress Tracking in `simple-server.js`
- Tracks progress updates when `UPDATE_NODE` operation includes progress changes
- Finds category parent for context
- Builds node path for hierarchy tracking
- Sends event to analytics service

```javascript
// When node progress changes
if (isDone || currentCompletions changed) {
  analytics.trackProgressUpdate(userId, graphId, nodeId, {
    nodePath,
    categoryId,
    previousProgress,
    currentProgress,
    isDone,
    currentCompletions,
    requiredCompletions
  });
}
```

### 3. Frontend Changes

#### New Analytics Service (`analyticsService-v2.js`)
- **Removed**: All session management code
- **Removed**: Event queue and batching
- **Simplified**: Direct API calls for analytics data
- **Focus**: Only fetch analytics, no tracking (handled by WebSocket)

#### API Endpoints (Simplified)
```javascript
// Main analytics endpoint
GET /api/analytics/:graphId?context=nodeId
Returns: {
  completedNodes: [],
  categoryProgress: [],
  distribution: {},
  totalNodes: number,
  completedCount: number,
  averageProgress: number
}

// Category analytics
GET /api/analytics/categories/:graphId?context=nodeId
Returns: [{
  id, name, emoji,
  progress: number,
  trend: number,
  completedTasks: number,
  totalTasks: number
}]
```

### 4. Context Filtering

Analytics now supports filtering by current breadcrumb context:
- Pass `context=nodeId` to filter analytics to only that node's descendants
- Without context, returns analytics for entire graph
- Useful for viewing progress at different hierarchy levels

### 5. Removed Features

#### Sessions
- No more session start/end tracking
- No focus time calculation
- No session-based metrics

#### Time Tracking
- Removed totalTimeSpent
- Removed averageSessionTime
- Removed duration calculations

#### Complex Events
- Removed node_created events
- Removed node_focus events (kept as simple log)
- Removed node_deleted events

## Migration Guide

### Backend
1. Replace `analytics.js` with `analytics-v2.js`
2. Update `simple-server.js` to use SimplifiedAnalytics
3. Remove session endpoints from API

### Frontend
1. Replace `analyticsService.js` with `analyticsService-v2.js`
2. Update TreeDaoStore imports
3. Remove all session-related code from components

### Dashboard Updates Needed
1. Remove "Activity focus and progress momentum" section
2. Simplify Period Selector to only "All time" for MVP
3. Move Pie chart to Effort Distribution section
4. Add completed nodes list
5. Simplify category cards

## Benefits

1. **Simplicity**: Removed complex session management
2. **Performance**: Aggregates updated once on event
3. **Scalability**: Event stream can be processed async
4. **Context-aware**: Supports breadcrumb filtering
5. **Real-time**: Updates flow through WebSocket instantly

## Future Enhancements

When ready to add time periods:
1. Create daily snapshots of aggregates
2. Compare snapshots for trend calculation
3. Add period selector back with actual data

## Testing

### Test Progress Tracking
```bash
# Start backend
cd dao_api2
npm run dev

# Open frontend
cd graphy
npm run dev

# Toggle node completion and verify:
1. WebSocket sends UPDATE_NODE
2. Backend tracks progress event
3. Analytics aggregates update
4. Dashboard reflects changes
```

### Test Context Filtering
```bash
# Navigate to a node in breadcrumb
# Analytics should show only that node's descendants
# Navigate back to root
# Analytics should show entire graph
```

## API Examples

### Get analytics for entire graph
```bash
curl http://localhost:3001/api/analytics/main \
  -H "X-User-Id: test-user-001"
```

### Get analytics for specific context
```bash
curl http://localhost:3001/api/analytics/main?context=node123 \
  -H "X-User-Id: test-user-001"
```

### Get category analytics
```bash
curl http://localhost:3001/api/analytics/categories/main \
  -H "X-User-Id: test-user-001"
```

## Summary

The refactored analytics system is now:
- **Focused**: Only tracks what matters (progress)
- **Simple**: No complex session logic
- **Fast**: Aggregates pre-calculated
- **Flexible**: Context-aware filtering
- **Ready**: For future enhancements with snapshots

This creates a solid foundation for analytics that can grow with the product needs.