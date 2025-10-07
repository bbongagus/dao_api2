# Streaming Analytics Architecture for Historical Progress Comparison

## Problem Statement
Need to compare current progress (last 30 days) with historical progress (30 days ago) using Redis Streams without traditional database.

## Solution 1: Time-Bucketed Aggregations (Recommended)

### Architecture
```
Events Stream → Continuous Aggregation → Time Buckets → Comparison API
```

### Implementation

#### 1. Daily Snapshots in Redis
```javascript
// Structure: Sorted Set per node per day
KEY: progress:daily:{nodeId}
SCORE: timestamp (YYYYMMDD)
VALUE: JSON {progress, completions, total}

// Example
progress:daily:node123
- 20250829: {progress: 67, completions: 5, total: 8}
- 20250830: {progress: 68, completions: 6, total: 8}
```

#### 2. Aggregation Worker
```javascript
// dao_api2/src/analytics-aggregator.js
class ProgressAggregator {
  async aggregateDaily() {
    const endOfDay = new Date().setHours(23, 59, 59, 999);
    const nodes = await this.getAllNodes();
    
    for (const node of nodes) {
      const dailyKey = `progress:daily:${node.id}`;
      const dateScore = format(new Date(), 'yyyyMMdd');
      
      // Calculate current progress
      const progress = await this.calculateNodeProgress(node.id);
      
      // Store snapshot
      await redis.zadd(dailyKey, dateScore, JSON.stringify({
        progress: progress.percentage,
        completions: progress.completions,
        total: progress.total,
        timestamp: new Date().toISOString()
      }));
      
      // Maintain 90 days retention
      await this.pruneOldSnapshots(dailyKey, 90);
    }
  }
}
```

#### 3. Comparison API
```javascript
// dao_api2/src/routes/analytics.js
router.get('/progress-comparison', async (req, res) => {
  const { period = '30d', nodeIds } = req.query;
  const comparisons = [];
  
  for (const nodeId of nodeIds) {
    const now = new Date();
    const periodDays = parseInt(period);
    
    // Get current progress (aggregate last N days)
    const currentProgress = await getProgressRange(
      nodeId, 
      subDays(now, periodDays), 
      now
    );
    
    // Get historical progress (N days ago)
    const historicalProgress = await getProgressSnapshot(
      nodeId,
      subDays(now, periodDays)
    );
    
    comparisons.push({
      nodeId,
      current: currentProgress,
      historical: historicalProgress,
      trend: currentProgress - historicalProgress,
      trendPercentage: calculateTrendPercentage(currentProgress, historicalProgress)
    });
  }
  
  res.json({ comparisons });
});
```

## Solution 2: Event Sourcing with Windowed Streams

### Architecture
```
Progress Events → Time Windows → Materialized Views → Query Engine
```

### Implementation

#### 1. Windowed Streams
```javascript
// Store events in time-based streams
KEY: events:progress:{nodeId}:{window}
// window = YYYY-MM-DD or YYYY-WW (week)

// Consumer groups for different time windows
- daily-aggregator
- weekly-aggregator
- monthly-aggregator
```

#### 2. Stream Processing
```javascript
class StreamProcessor {
  async processProgressEvent(event) {
    // Write to current window
    const windowKey = this.getWindowKey(event.nodeId, event.timestamp);
    await redis.xadd(windowKey, '*', 
      'nodeId', event.nodeId,
      'progress', event.progress,
      'completions', event.completions,
      'timestamp', event.timestamp
    );
    
    // Update running aggregates
    await this.updateRunningAggregate(event);
  }
  
  async updateRunningAggregate(event) {
    // Sliding window aggregation
    const windows = ['1d', '7d', '30d'];
    
    for (const window of windows) {
      const key = `aggregate:${window}:${event.nodeId}`;
      const aggregate = await this.getOrCreateAggregate(key);
      
      // Update aggregate
      aggregate.addEvent(event);
      aggregate.removeOldEvents(window);
      
      // Store updated aggregate
      await redis.hset(key, {
        progress: aggregate.getAverageProgress(),
        completions: aggregate.getTotalCompletions(),
        lastUpdate: event.timestamp
      });
    }
  }
}
```

## Solution 3: Hybrid Approach with BullMQ Jobs

### Architecture
```
Real-time Events → BullMQ → Scheduled Snapshots → Comparison Cache
```

### Implementation

#### 1. Scheduled Snapshot Jobs
```javascript
// dao_api2/src/jobs/snapshot-job.js
export const snapshotJob = {
  name: 'progress-snapshot',
  schedule: '0 0 * * *', // Daily at midnight
  
  async process() {
    const nodes = await getAllNodes();
    const snapshotDate = format(new Date(), 'yyyy-MM-dd');
    
    for (const node of nodes) {
      // Calculate progress from stream
      const progress = await calculateProgressFromStream(node.id);
      
      // Store in time-series structure
      await redis.ts.add(
        `ts:progress:${node.id}`,
        Date.now(),
        progress.percentage
      );
      
      // Also store detailed snapshot
      await redis.hset(
        `snapshot:${snapshotDate}`,
        node.id,
        JSON.stringify(progress)
      );
    }
  }
};
```

#### 2. Query with Caching
```javascript
class ProgressComparison {
  async getComparison(nodeId, period) {
    const cacheKey = `comparison:${nodeId}:${period}`;
    
    // Check cache first
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
    
    // Calculate comparison
    const comparison = await this.calculateComparison(nodeId, period);
    
    // Cache for 1 hour
    await redis.setex(cacheKey, 3600, JSON.stringify(comparison));
    
    return comparison;
  }
  
  async calculateComparison(nodeId, period) {
    const now = Date.now();
    const periodMs = this.periodToMs(period);
    
    // Get current value from time-series
    const current = await redis.ts.get(`ts:progress:${nodeId}`);
    
    // Get historical value
    const historical = await redis.ts.range(
      `ts:progress:${nodeId}`,
      now - periodMs - 86400000, // period ago -1 day
      now - periodMs + 86400000  // period ago +1 day
    );
    
    return {
      current: current.value,
      historical: this.average(historical),
      trend: current.value - this.average(historical)
    };
  }
}
```

## Solution 4: Lightweight Rolling Aggregates

### Architecture
```
Events → Rolling Windows → Compact Storage → Fast Queries
```

### Implementation

#### 1. Rolling Window Storage
```javascript
// Store only key metrics in rolling windows
class RollingWindow {
  constructor(nodeId, windowSize = 30) {
    this.key = `rolling:${nodeId}:${windowSize}d`;
    this.windowSize = windowSize;
  }
  
  async update(progress, timestamp) {
    const dayKey = format(timestamp, 'yyyyMMdd');
    
    // Add to sorted set
    await redis.zadd(this.key, dayKey, progress);
    
    // Trim to window size
    const cutoff = format(
      subDays(new Date(), this.windowSize), 
      'yyyyMMdd'
    );
    await redis.zremrangebyscore(this.key, '-inf', cutoff);
  }
  
  async getSnapshot(daysAgo) {
    const targetDay = format(
      subDays(new Date(), daysAgo),
      'yyyyMMdd'
    );
    
    return await redis.zscore(this.key, targetDay);
  }
}
```

#### 2. Comparison Service
```javascript
class ComparisonService {
  async compareProgress(nodeId, period = '30d') {
    const days = parseInt(period);
    const window = new RollingWindow(nodeId, days * 2);
    
    // Get current average (last N days)
    const currentRange = await redis.zrange(
      window.key,
      -days,
      -1,
      'WITHSCORES'
    );
    
    // Get historical point (N days ago)
    const historicalPoint = await window.getSnapshot(days);
    
    const currentAvg = this.calculateAverage(currentRange);
    
    return {
      nodeId,
      period,
      current: currentAvg,
      historical: historicalPoint || 0,
      trend: currentAvg - (historicalPoint || 0),
      dataPoints: currentRange.length
    };
  }
}
```

## Recommended Implementation Path

### Phase 1: Daily Snapshots (Quick Win)
1. Implement daily snapshot job using existing progress data
2. Store in Redis sorted sets (30-60 days retention)
3. Simple comparison API

### Phase 2: Real-time Aggregation
1. Add stream processing for progress events
2. Maintain running aggregates for common periods
3. Cache comparison results

### Phase 3: Advanced Analytics
1. Add time-series support for trends
2. Implement predictive analytics
3. Add anomaly detection

## Performance Considerations

### Storage Optimization
- Daily snapshots: ~100 bytes per node per day
- 1000 nodes × 90 days = ~9MB storage
- Use compression for older data

### Query Performance
- Pre-aggregate common periods (7d, 30d)
- Cache comparison results (1-hour TTL)
- Use Redis pipeline for batch queries

### Scalability
- Partition by node ID for horizontal scaling
- Use Redis Cluster for large deployments
- Consider time-series databases for long-term storage

## Integration with Current System

### Minimal Changes Required
```javascript
// dao_api2/src/analytics-v2.js
class AnalyticsService {
  // Add to existing class
  async snapshotProgress() {
    // Called by daily job
  }
  
  async getProgressComparison(nodeIds, period) {
    // New endpoint method
  }
}

// dao_api2/src/worker.js
// Add scheduled job for snapshots
scheduleJob('0 0 * * *', async () => {
  await analyticsService.snapshotProgress();
});
```

## Benefits of Streaming Approach

1. **No Additional Dependencies**: Uses only Redis
2. **Real-time Ready**: Can provide up-to-minute comparisons
3. **Scalable**: Handles millions of events efficiently
4. **Flexible**: Easy to add new time periods
5. **Maintainable**: Clear separation of concerns
6. **Cost-effective**: Minimal storage requirements