# Optimistic UI Migration Plan
## From Current Architecture to Redis + BullMQ

### Executive Summary
This document outlines a detailed 6-week migration plan to transition Graphy from its current synchronous API architecture to an Optimistic UI system powered by Redis and BullMQ.

---

## 📅 Timeline Overview

| Week | Phase | Focus | Risk Level |
|------|-------|-------|------------|
| 1-2 | Foundation | Infrastructure setup, parallel deployment | Low |
| 3-4 | Implementation | Core functionality, testing | Medium |
| 5 | Migration | Data migration, gradual rollout | High |
| 6 | Optimization | Performance tuning, monitoring | Low |

---

## Week 1-2: Foundation Phase

### Goals
- Set up Redis and BullMQ infrastructure
- Deploy parallel backend system
- Establish monitoring and logging

### Tasks

#### Infrastructure Setup
```bash
# Day 1-2: Redis Cluster
1. Deploy Redis with persistence
2. Configure replication (master-slave)
3. Set up Redis Sentinel for HA
4. Test failover scenarios

# Day 3-4: BullMQ Setup
1. Deploy worker nodes (3 instances)
2. Configure job queues
3. Set up dead letter queues
4. Implement job monitoring dashboard

# Day 5-7: WebSocket Infrastructure
1. Deploy WebSocket servers
2. Configure load balancing
3. Implement connection pooling
4. Test concurrent connections (target: 1000)
```

#### Parallel Deployment
```yaml
# docker-compose.production.yml
version: '3.8'

services:
  # New Optimistic Backend
  redis-master:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-master-data:/data
    networks:
      - dao-network

  redis-slave:
    image: redis:7-alpine
    command: redis-server --replicaof redis-master 6379
    depends_on:
      - redis-master
    networks:
      - dao-network

  api-v2:
    image: dao-api:v2
    environment:
      - API_VERSION=v2
      - REDIS_MASTER=redis-master
      - REDIS_SLAVE=redis-slave
    ports:
      - "3001:3000"  # New port for v2
    networks:
      - dao-network

  # Existing Backend (keep running)
  api-v1:
    image: dao-api:v1
    ports:
      - "3000:3000"  # Original port
    networks:
      - dao-network

networks:
  dao-network:
    driver: bridge

volumes:
  redis-master-data:
  redis-slave-data:
```

### Monitoring Setup
```javascript
// monitoring/metrics.js
import prometheus from 'prom-client';

// Define metrics
const metrics = {
  // Command processing metrics
  commandsProcessed: new prometheus.Counter({
    name: 'optimistic_commands_processed_total',
    help: 'Total number of commands processed',
    labelNames: ['type', 'status']
  }),
  
  commandDuration: new prometheus.Histogram({
    name: 'optimistic_command_duration_seconds',
    help: 'Command processing duration',
    labelNames: ['type'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
  }),
  
  // Conflict metrics
  conflictsDetected: new prometheus.Counter({
    name: 'optimistic_conflicts_total',
    help: 'Total number of conflicts detected',
    labelNames: ['resolution_type']
  }),
  
  // WebSocket metrics
  activeConnections: new prometheus.Gauge({
    name: 'websocket_active_connections',
    help: 'Number of active WebSocket connections'
  }),
  
  // Queue metrics
  queueSize: new prometheus.Gauge({
    name: 'bullmq_queue_size',
    help: 'Current queue size',
    labelNames: ['queue_name']
  }),
  
  queueLatency: new prometheus.Histogram({
    name: 'bullmq_queue_latency_seconds',
    help: 'Queue processing latency',
    labelNames: ['queue_name']
  })
};

// Grafana Dashboard Configuration
const grafanaDashboard = {
  "dashboard": {
    "title": "Optimistic UI Metrics",
    "panels": [
      {
        "title": "Command Success Rate",
        "targets": [{
          "expr": "rate(optimistic_commands_processed_total{status='success'}[5m]) / rate(optimistic_commands_processed_total[5m])"
        }]
      },
      {
        "title": "P95 Command Latency",
        "targets": [{
          "expr": "histogram_quantile(0.95, rate(optimistic_command_duration_seconds_bucket[5m]))"
        }]
      },
      {
        "title": "Conflict Rate",
        "targets": [{
          "expr": "rate(optimistic_conflicts_total[5m])"
        }]
      },
      {
        "title": "Active WebSocket Connections",
        "targets": [{
          "expr": "websocket_active_connections"
        }]
      }
    ]
  }
};
```

### Success Criteria
- [ ] Redis cluster operational with < 5ms latency
- [ ] BullMQ processing 1000+ jobs/second
- [ ] WebSocket handling 1000+ concurrent connections
- [ ] Monitoring dashboard showing all key metrics
- [ ] Zero impact on existing v1 API

---

## Week 3-4: Implementation Phase

### Goals
- Implement dual-write mechanism
- Build data synchronization
- Create comprehensive test suite

### Dual-Write Implementation
```javascript
// services/dualWrite.js
class DualWriteService {
  constructor(v1API, v2API) {
    this.v1API = v1API;
    this.v2API = v2API;
    this.metrics = new MetricsCollector();
  }

  async writeOperation(operation, data) {
    const results = {
      v1: { success: false, error: null, latency: 0 },
      v2: { success: false, error: null, latency: 0 }
    };

    // Write to v1 (existing system)
    const v1Start = Date.now();
    try {
      await this.v1API[operation](data);
      results.v1.success = true;
      results.v1.latency = Date.now() - v1Start;
    } catch (error) {
      results.v1.error = error.message;
      console.error('V1 write failed:', error);
    }

    // Write to v2 (new optimistic system)
    const v2Start = Date.now();
    try {
      await this.v2API.executeCommand(operation, data);
      results.v2.success = true;
      results.v2.latency = Date.now() - v2Start;
    } catch (error) {
      results.v2.error = error.message;
      console.error('V2 write failed:', error);
    }

    // Record metrics
    this.metrics.recordDualWrite(operation, results);

    // Detect discrepancies
    if (results.v1.success !== results.v2.success) {
      await this.handleDiscrepancy(operation, data, results);
    }

    // Return v1 result to maintain compatibility
    if (!results.v1.success) {
      throw new Error(results.v1.error);
    }

    return results;
  }

  async handleDiscrepancy(operation, data, results) {
    // Log discrepancy for investigation
    await this.logDiscrepancy({
      operation,
      data,
      results,
      timestamp: Date.now()
    });

    // Send alert if critical operation
    if (this.isCriticalOperation(operation)) {
      await this.sendAlert({
        level: 'HIGH',
        message: `Discrepancy detected in ${operation}`,
        details: results
      });
    }
  }

  isCriticalOperation(operation) {
    const criticalOps = ['DELETE_NODE', 'DELETE_GRAPH', 'UPDATE_PERMISSIONS'];
    return criticalOps.includes(operation);
  }
}
```

### Data Migration Strategy
```javascript
// scripts/dataMigration.js
class DataMigrator {
  constructor(source, target) {
    this.source = source;  // PostgreSQL/Current system
    this.target = target;  // Redis
    this.batchSize = 100;
    this.progress = {
      total: 0,
      processed: 0,
      failed: 0,
      startTime: Date.now()
    };
  }

  async migrate() {
    console.log('🚀 Starting data migration...');
    
    // Phase 1: Migrate user data
    await this.migrateUsers();
    
    // Phase 2: Migrate graphs
    await this.migrateGraphs();
    
    // Phase 3: Migrate nodes and edges
    await this.migrateNodesAndEdges();
    
    // Phase 4: Verify integrity
    await this.verifyMigration();
    
    this.printReport();
  }

  async migrateGraphs() {
    const graphs = await this.source.getAllGraphs();
    this.progress.total = graphs.length;
    
    for (let i = 0; i < graphs.length; i += this.batchSize) {
      const batch = graphs.slice(i, i + this.batchSize);
      
      await Promise.all(batch.map(async (graph) => {
        try {
          // Transform to new format
          const transformed = this.transformGraph(graph);
          
          // Write to Redis
          await this.target.saveGraph(transformed);
          
          this.progress.processed++;
          
          // Log progress every 100 items
          if (this.progress.processed % 100 === 0) {
            this.logProgress();
          }
        } catch (error) {
          this.progress.failed++;
          console.error(`Failed to migrate graph ${graph.id}:`, error);
        }
      }));
      
      // Rate limiting to avoid overwhelming the system
      await this.sleep(100);
    }
  }

  transformGraph(oldGraph) {
    return {
      graphId: oldGraph.id,
      userId: oldGraph.user_id,
      name: oldGraph.name || 'Untitled',
      viewport: {
        x: oldGraph.viewport_x || 0,
        y: oldGraph.viewport_y || 0,
        zoom: oldGraph.viewport_zoom || 1
      },
      version: 1,
      createdAt: oldGraph.created_at,
      updatedAt: oldGraph.updated_at
    };
  }

  async verifyMigration() {
    console.log('🔍 Verifying migration integrity...');
    
    const sourceCount = await this.source.getGraphCount();
    const targetCount = await this.target.getGraphCount();
    
    if (sourceCount !== targetCount) {
      throw new Error(`Count mismatch: Source=${sourceCount}, Target=${targetCount}`);
    }
    
    // Sample verification
    const sampleSize = Math.min(100, sourceCount);
    const samples = await this.source.getRandomGraphs(sampleSize);
    
    for (const sample of samples) {
      const targetGraph = await this.target.getGraph(sample.id);
      if (!targetGraph) {
        throw new Error(`Graph ${sample.id} not found in target`);
      }
      
      // Verify key fields
      this.verifyGraphIntegrity(sample, targetGraph);
    }
    
    console.log('✅ Migration verification passed');
  }

  printReport() {
    const duration = (Date.now() - this.progress.startTime) / 1000;
    const successRate = ((this.progress.processed / this.progress.total) * 100).toFixed(2);
    
    console.log('\n📊 Migration Report:');
    console.log(`├─ Total items: ${this.progress.total}`);
    console.log(`├─ Successfully migrated: ${this.progress.processed}`);
    console.log(`├─ Failed: ${this.progress.failed}`);
    console.log(`├─ Success rate: ${successRate}%`);
    console.log(`├─ Duration: ${duration}s`);
    console.log(`└─ Average speed: ${(this.progress.processed / duration).toFixed(2)} items/s`);
  }
}
```

### Testing Strategy
```javascript
// tests/integration/optimistic.test.js
describe('Optimistic UI Integration Tests', () => {
  let v1API, v2API;
  
  beforeAll(async () => {
    // Start test environments
    v1API = await startV1TestServer();
    v2API = await startV2TestServer();
  });
  
  describe('Consistency Tests', () => {
    test('Both APIs should produce same result for CREATE_NODE', async () => {
      const nodeData = {
        title: 'Test Node',
        position: { x: 100, y: 100 }
      };
      
      const v1Result = await v1API.createNode(nodeData);
      const v2Result = await v2API.createNode(nodeData);
      
      expect(v1Result.title).toBe(v2Result.title);
      expect(v1Result.position).toEqual(v2Result.position);
    });
    
    test('Conflict resolution should maintain consistency', async () => {
      // Create conflicting updates
      const node = await v2API.createNode({ title: 'Conflict Test' });
      
      // Simulate concurrent updates
      const update1 = v2API.updateNode(node.id, { title: 'Update 1' });
      const update2 = v2API.updateNode(node.id, { title: 'Update 2' });
      
      await Promise.all([update1, update2]);
      
      // Verify final state is consistent
      const finalNode = await v2API.getNode(node.id);
      expect(['Update 1', 'Update 2']).toContain(finalNode.title);
    });
  });
  
  describe('Performance Tests', () => {
    test('Optimistic updates should complete within 100ms', async () => {
      const start = Date.now();
      
      await v2API.executeCommand('CREATE_NODE', {
        title: 'Performance Test',
        position: { x: 0, y: 0 }
      });
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });
    
    test('Should handle 100 concurrent operations', async () => {
      const operations = Array(100).fill(null).map((_, i) => 
        v2API.executeCommand('CREATE_NODE', {
          title: `Concurrent ${i}`,
          position: { x: i * 10, y: i * 10 }
        })
      );
      
      const results = await Promise.allSettled(operations);
      const successful = results.filter(r => r.status === 'fulfilled');
      
      expect(successful.length).toBeGreaterThan(95); // Allow 5% failure rate
    });
  });
});
```

### Success Criteria
- [ ] Dual-write operational with < 1% discrepancy rate
- [ ] All integration tests passing
- [ ] Performance benchmarks met (< 100ms p95 latency)
- [ ] Data migration script tested on staging
- [ ] Rollback procedure documented and tested

---

## Week 5: Migration Phase

### Goals
- Execute production data migration
- Implement gradual rollout
- Monitor and validate

### Gradual Rollout Plan

#### Stage 1: Internal Testing (Day 1)
```javascript
// Enable for internal team only
const rolloutConfig = {
  stage: 'internal',
  percentage: 0,
  whitelist: ['team@company.com'],
  features: {
    optimisticNodes: true,
    optimisticEdges: false,
    realTimeSync: true
  }
};
```

#### Stage 2: Beta Users (Day 2-3)
```javascript
// 5% of beta users
const rolloutConfig = {
  stage: 'beta',
  percentage: 5,
  whitelist: [...betaUsers],
  features: {
    optimisticNodes: true,
    optimisticEdges: true,
    realTimeSync: true
  }
};
```

#### Stage 3: Gradual Rollout (Day 4-5)
```javascript
// Progressive rollout
const rolloutSchedule = [
  { hour: 0, percentage: 10 },
  { hour: 4, percentage: 25 },
  { hour: 8, percentage: 50 },
  { hour: 12, percentage: 75 },
  { hour: 16, percentage: 100 }
];
```

### Production Migration Checklist

#### Pre-Migration
- [ ] Full database backup completed
- [ ] Redis cluster health check passed
- [ ] BullMQ workers scaled to handle load
- [ ] Monitoring dashboards configured
- [ ] Rollback procedure tested
- [ ] Team on standby

#### Migration Execution
```bash
# Step 1: Enable maintenance mode
kubectl set image deployment/frontend frontend=dao-frontend:maintenance

# Step 2: Start dual-write mode
kubectl set env deployment/api-v1 DUAL_WRITE_ENABLED=true

# Step 3: Run migration script
npm run migrate:production -- --verify --batch-size=100

# Step 4: Verify migration
npm run verify:migration

# Step 5: Enable gradual rollout
kubectl set env deployment/api-v2 ROLLOUT_STAGE=beta

# Step 6: Monitor metrics
watch -n 5 'kubectl top pods | grep api'
```

#### Post-Migration Validation
```javascript
// validation/postMigration.js
async function validateMigration() {
  const checks = [
    {
      name: 'Data Integrity',
      test: async () => {
        const v1Count = await v1API.getGraphCount();
        const v2Count = await v2API.getGraphCount();
        return v1Count === v2Count;
      }
    },
    {
      name: 'Performance',
      test: async () => {
        const latencies = await runPerformanceTest(100);
        return latencies.p95 < 100;
      }
    },
    {
      name: 'WebSocket Connectivity',
      test: async () => {
        const connections = await testWebSocketConnections(10);
        return connections.success === connections.total;
      }
    },
    {
      name: 'Conflict Resolution',
      test: async () => {
        const conflicts = await simulateConflicts(5);
        return conflicts.resolved === conflicts.total;
      }
    }
  ];
  
  for (const check of checks) {
    console.log(`Running ${check.name}...`);
    const passed = await check.test();
    console.log(`${passed ? '✅' : '❌'} ${check.name}`);
    
    if (!passed) {
      throw new Error(`Validation failed: ${check.name}`);
    }
  }
  
  console.log('🎉 All post-migration checks passed!');
}
```

### Rollback Procedure

If critical issues are detected:

```bash
# Immediate rollback (< 5 minutes)
# Step 1: Disable v2 API
kubectl scale deployment/api-v2 --replicas=0

# Step 2: Disable dual-write
kubectl set env deployment/api-v1 DUAL_WRITE_ENABLED=false

# Step 3: Route all traffic to v1
kubectl patch service api -p '{"spec":{"selector":{"version":"v1"}}}'

# Step 4: Notify users
kubectl set image deployment/frontend frontend=dao-frontend:rollback-notice
```

---

## Week 6: Optimization Phase

### Goals
- Fine-tune performance
- Optimize resource usage
- Complete documentation

### Performance Optimization

#### Redis Optimization
```javascript
// Implement caching layer
class OptimizedCache {
  constructor() {
    this.l1Cache = new Map(); // In-memory cache
    this.l2Cache = redis;      // Redis cache
    
    // L1 cache settings
    this.maxL1Size = 1000;
    this.l1TTL = 60 * 1000; // 1 minute
  }
  
  async get(key) {
    // Try L1 cache first
    const l1Result = this.l1Cache.get(key);
    if (l1Result && l1Result.expires > Date.now()) {
      return l1Result.value;
    }
    
    // Try L2 cache (Redis)
    const l2Result = await this.l2Cache.get(key);
    if (l2Result) {
      // Populate L1
      this.setL1(key, l2Result);
      return l2Result;
    }
    
    return null;
  }
  
  setL1(key, value) {
    // Implement LRU if at capacity
    if (this.l1Cache.size >= this.maxL1Size) {
      const firstKey = this.l1Cache.keys().next().value;
      this.l1Cache.delete(firstKey);
    }
    
    this.l1Cache.set(key, {
      value,
      expires: Date.now() + this.l1TTL
    });
  }
}
```

#### Queue Optimization
```javascript
// Optimize BullMQ processing
const optimizedWorker = new Worker(
  'graph-commands',
  async (job) => {
    // Batch similar operations
    if (job.name === 'UPDATE_NODE_POSITION') {
      return batchProcessor.add(job);
    }
    
    // Process immediately
    return processCommand(job);
  },
  {
    concurrency: 10,
    limiter: {
      max: 2000,
      duration: 1000
    },
    settings: {
      stalledInterval: 30000,
      maxStalledCount: 1
    }
  }
);

// Batch processor for position updates
const batchProcessor = new BatchProcessor({
  maxBatchSize: 50,
  maxWaitTime: 100,
  processor: async (batch) => {
    const updates = batch.map(job => ({
      nodeId: job.data.nodeId,
      position: job.data.position
    }));
    
    // Single Redis transaction for all updates
    const pipeline = redis.pipeline();
    updates.forEach(update => {
      pipeline.hset(
        `graph:${job.data.graphId}:nodes`,
        update.nodeId,
        JSON.stringify(update.position)
      );
    });
    
    return pipeline.exec();
  }
});
```

### Resource Optimization
```yaml
# kubernetes/optimized-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-v2-optimized
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: api
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        env:
        - name: NODE_OPTIONS
          value: "--max-old-space-size=400"
        - name: UV_THREADPOOL_SIZE
          value: "8"
      
      # Add Redis sidecar for local caching
      - name: redis-cache
        image: redis:7-alpine
        resources:
          requests:
            memory: "64Mi"
            cpu: "50m"
          limits:
            memory: "128Mi"
            cpu: "100m"
```

### Documentation Completion
- [ ] API documentation with examples
- [ ] WebSocket protocol specification
- [ ] Conflict resolution guide
- [ ] Performance tuning guide
- [ ] Troubleshooting guide
- [ ] Runbook for common issues

---

## 🎯 Success Metrics

### Technical Metrics
| Metric | Target | Actual |
|--------|--------|---------|
| P95 Latency | < 100ms | _TBD_ |
| P99 Latency | < 500ms | _TBD_ |
| Conflict Rate | < 0.1% | _TBD_ |
| Success Rate | > 99.9% | _TBD_ |
| WebSocket Uptime | > 99.95% | _TBD_ |

### Business Metrics
| Metric | Baseline | Target | Actual |
|--------|----------|--------|---------|
| User Engagement | 100% | +15% | _TBD_ |
| Session Duration | 20 min | +25% | _TBD_ |
| Error Reports | 50/week | -80% | _TBD_ |
| Performance Complaints | 10/week | -90% | _TBD_ |

---

## 🚨 Risk Management

### Identified Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Data Loss | Low | Critical | Dual-write, backups, validation |
| Performance Degradation | Medium | High | Gradual rollout, monitoring |
| Redis Failure | Low | Critical | Cluster setup, failover |
| Conflict Storms | Medium | Medium | Rate limiting, conflict resolution |
| WebSocket Overload | Low | Medium | Connection limits, scaling |

### Contingency Plans

1. **Data Corruption**
   - Immediate: Stop writes, investigate
   - Recovery: Restore from backup
   - Prevention: Add checksums, validation

2. **Performance Crisis**
   - Immediate: Scale resources
   - Short-term: Disable optimistic features
   - Long-term: Optimize critical paths

3. **Complete Failure**
   - Immediate: Full rollback to v1
   - Recovery: Fix issues in staging
   - Re-attempt: With lessons learned

---

## 📝 Sign-off Checklist

### Technical Team
- [ ] Backend Lead approval
- [ ] Frontend Lead approval
- [ ] DevOps Lead approval
- [ ] QA Lead approval

### Business Team
- [ ] Product Manager approval
- [ ] Customer Success briefed
- [ ] Support team trained
- [ ] Communication plan ready

### Final Go/No-Go Decision
- [ ] All success criteria met
- [ ] Rollback tested successfully
- [ ] Team available for support
- [ ] Users notified of changes

---

This migration plan provides a structured, low-risk approach to transitioning to the Optimistic UI architecture while maintaining system stability and the ability to rollback if needed.