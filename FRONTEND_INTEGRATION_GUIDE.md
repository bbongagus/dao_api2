# Frontend Integration Guide for Optimistic UI

## Overview
This guide explains how to integrate the existing Graphy frontend with the new Optimistic UI backend, enabling instant UI updates with eventual consistency.

---

## 1. Client-Side Architecture Changes

### Updated Service Layer Structure

```javascript
// services/optimisticApi.js
import { v4 as uuidv4 } from 'uuid';

class OptimisticAPIService {
  constructor() {
    this.baseURL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api/v2';
    this.wsURL = process.env.REACT_APP_WS_URL || 'ws://localhost:8080';
    this.pendingOperations = new Map();
    this.clientVersion = 0;
    this.ws = null;
    this.reconnectAttempts = 0;
  }

  // Initialize WebSocket connection
  async connect(userId, graphId) {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        userId,
        graphId,
        version: this.clientVersion
      });
      
      this.ws = new WebSocket(`${this.wsURL}?${params}`);
      
      this.ws.onopen = () => {
        console.log('✅ WebSocket connected');
        this.reconnectAttempts = 0;
        this.setupMessageHandlers();
        resolve();
      };
      
      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        reject(error);
      };
      
      this.ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        this.handleDisconnect();
      };
    });
  }

  // Execute command optimistically
  async executeCommand(type, payload) {
    const operationId = uuidv4();
    
    // Track pending operation
    this.pendingOperations.set(operationId, {
      type,
      payload,
      timestamp: Date.now(),
      status: 'pending'
    });
    
    // Send command to backend
    const response = await fetch(`${this.baseURL}/graphs/${this.graphId}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify({
        operationId,
        type,
        payload,
        clientVersion: this.clientVersion,
        timestamp: Date.now()
      })
    });
    
    if (!response.ok) {
      // Remove from pending and throw error
      this.pendingOperations.delete(operationId);
      throw new Error('Command failed');
    }
    
    const result = await response.json();
    return { operationId, ...result };
  }

  // Handle WebSocket messages
  setupMessageHandlers() {
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'SYNC':
          this.handleSync(message.data);
          break;
          
        case 'STATE_UPDATE':
          this.handleStateUpdate(message);
          break;
          
        case 'REVERT':
          this.handleRevert(message);
          break;
          
        case 'CONFLICT':
          this.handleConflict(message);
          break;
          
        default:
          console.log('Unknown message type:', message.type);
      }
    };
  }

  // Handle state synchronization
  handleSync(syncData) {
    if (syncData.status === 'in_sync') {
      console.log('✅ Client in sync with server');
      return;
    }
    
    // Update local state with server state
    this.clientVersion = syncData.version;
    
    // Notify store to update
    if (this.onSync) {
      this.onSync(syncData.state);
    }
  }

  // Handle state updates from server
  handleStateUpdate(message) {
    const { operationId, result, version } = message;
    
    // Update client version
    this.clientVersion = version;
    
    // Mark operation as completed
    const operation = this.pendingOperations.get(operationId);
    if (operation) {
      operation.status = 'completed';
      this.pendingOperations.delete(operationId);
    }
    
    // Notify store of confirmed update
    if (this.onUpdate) {
      this.onUpdate(result);
    }
  }

  // Handle optimistic revert
  handleRevert(message) {
    const { operationId, error } = message;
    
    console.warn('⚠️ Reverting optimistic update:', operationId, error);
    
    // Remove from pending
    const operation = this.pendingOperations.get(operationId);
    this.pendingOperations.delete(operationId);
    
    // Notify store to revert
    if (this.onRevert) {
      this.onRevert(operationId, operation);
    }
  }

  // Handle conflicts
  handleConflict(message) {
    console.warn('⚠️ Conflict detected:', message);
    
    if (this.onConflict) {
      this.onConflict(message);
    }
  }

  // Reconnection logic
  handleDisconnect() {
    if (this.reconnectAttempts < 5) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      
      console.log(`🔄 Reconnecting in ${delay}ms...`);
      
      setTimeout(() => {
        this.connect(this.userId, this.graphId);
      }, delay);
    }
  }
}

export const optimisticAPI = new OptimisticAPIService();
```

---

## 2. MobX Store Integration

### Enhanced TreeDaoStore with Optimistic Updates

```javascript
// stores/models/OptimisticTreeDaoStore.js
import { types, flow, applySnapshot } from "mobx-state-tree";
import { optimisticAPI } from '../../services/optimisticApi';

export const OptimisticTreeDaoStore = types
  .model("OptimisticTreeDaoStore", {
    // ... existing model definition ...
    optimisticUpdates: types.map(types.frozen()), // Track optimistic changes
    serverVersion: types.number,
    isSyncing: types.boolean
  })
  .actions(self => {
    // Connect to WebSocket on initialization
    const connectToBackend = flow(function* () {
      try {
        yield optimisticAPI.connect(self.userId, self.currentGraphId);
        
        // Set up handlers
        optimisticAPI.onSync = (state) => self.handleServerSync(state);
        optimisticAPI.onUpdate = (update) => self.handleServerUpdate(update);
        optimisticAPI.onRevert = (id, op) => self.handleRevert(id, op);
        optimisticAPI.onConflict = (conflict) => self.handleConflict(conflict);
        
      } catch (error) {
        console.error('Failed to connect to backend:', error);
      }
    });

    // Optimistic node creation
    const addNodeOptimistic = flow(function* (title, nodeType, position) {
      // Create node locally first (optimistic)
      const tempNode = {
        id: `temp_${Date.now()}`,
        title,
        nodeType,
        position,
        isOptimistic: true
      };
      
      // Add to local state immediately
      self.currentLevel.push(tempNode);
      
      // Send command to backend
      try {
        const result = yield optimisticAPI.executeCommand('CREATE_NODE', {
          title,
          nodeType,
          position,
          parentId: self.currentNode?.id
        });
        
        // Track optimistic update
        self.optimisticUpdates.set(result.operationId, {
          type: 'CREATE_NODE',
          tempId: tempNode.id,
          timestamp: Date.now()
        });
        
      } catch (error) {
        // Revert on error
        self.removeNode(tempNode.id);
        console.error('Failed to create node:', error);
      }
    });

    // Optimistic position update
    const updateNodePositionOptimistic = flow(function* (nodeId, position) {
      const node = self.findNodeById(nodeId);
      if (!node) return;
      
      // Store old position for revert
      const oldPosition = { ...node.position };
      
      // Update locally immediately
      node.updatePosition(position.x, position.y);
      
      // Send to backend
      try {
        const result = yield optimisticAPI.executeCommand('UPDATE_NODE_POSITION', {
          nodeId,
          position
        });
        
        // Track for potential revert
        self.optimisticUpdates.set(result.operationId, {
          type: 'UPDATE_POSITION',
          nodeId,
          oldPosition,
          newPosition: position
        });
        
      } catch (error) {
        // Revert position
        node.updatePosition(oldPosition.x, oldPosition.y);
        console.error('Failed to update position:', error);
      }
    });

    // Optimistic edge creation
    const addEdgeOptimistic = flow(function* (connection) {
      // Create edge locally
      const tempEdge = {
        id: `temp_edge_${Date.now()}`,
        source: connection.source,
        target: connection.target,
        isOptimistic: true
      };
      
      self.allEdges.push(tempEdge);
      
      // Send to backend
      try {
        const result = yield optimisticAPI.executeCommand('CREATE_EDGE', connection);
        
        self.optimisticUpdates.set(result.operationId, {
          type: 'CREATE_EDGE',
          tempId: tempEdge.id
        });
        
      } catch (error) {
        // Remove edge
        self.removeEdge(tempEdge.id);
        console.error('Failed to create edge:', error);
      }
    });

    // Handle server sync
    const handleServerSync = (serverState) => {
      console.log('📥 Syncing with server state');
      self.isSyncing = true;
      
      // Clear optimistic updates
      self.optimisticUpdates.clear();
      
      // Apply server state
      self.rootNodes.clear();
      self.allEdges.clear();
      
      // Rebuild from server state
      serverState.nodes.forEach(node => {
        self.rootNodes.push(node);
      });
      
      serverState.edges.forEach(edge => {
        self.allEdges.push(edge);
      });
      
      self.serverVersion = serverState.version;
      self.isSyncing = false;
    };

    // Handle confirmed server update
    const handleServerUpdate = (update) => {
      // Update confirmed, remove from optimistic tracking
      const optimistic = self.optimisticUpdates.get(update.operationId);
      
      if (optimistic) {
        // Replace temporary IDs with real IDs
        if (optimistic.type === 'CREATE_NODE' && optimistic.tempId) {
          const tempNode = self.findNodeById(optimistic.tempId);
          if (tempNode && update.result.id) {
            tempNode.id = update.result.id;
            tempNode.isOptimistic = false;
          }
        }
        
        if (optimistic.type === 'CREATE_EDGE' && optimistic.tempId) {
          const tempEdge = self.allEdges.find(e => e.id === optimistic.tempId);
          if (tempEdge && update.result.id) {
            tempEdge.id = update.result.id;
            tempEdge.isOptimistic = false;
          }
        }
        
        self.optimisticUpdates.delete(update.operationId);
      }
      
      self.serverVersion = update.version;
    };

    // Handle revert request
    const handleRevert = (operationId, operation) => {
      console.log('⏪ Reverting operation:', operationId);
      
      const optimistic = self.optimisticUpdates.get(operationId);
      if (!optimistic) return;
      
      switch (optimistic.type) {
        case 'CREATE_NODE':
          // Remove the optimistic node
          if (optimistic.tempId) {
            self.removeNode(optimistic.tempId);
          }
          break;
          
        case 'UPDATE_POSITION':
          // Revert to old position
          const node = self.findNodeById(optimistic.nodeId);
          if (node && optimistic.oldPosition) {
            node.updatePosition(optimistic.oldPosition.x, optimistic.oldPosition.y);
          }
          break;
          
        case 'CREATE_EDGE':
          // Remove the optimistic edge
          if (optimistic.tempId) {
            self.removeEdge(optimistic.tempId);
          }
          break;
      }
      
      self.optimisticUpdates.delete(operationId);
    };

    // Handle conflicts
    const handleConflict = (conflict) => {
      console.warn('🔄 Handling conflict:', conflict);
      
      // Simple strategy: accept server state
      // In production, might show UI for manual resolution
      if (conflict.resolution === 'SERVER_WINS') {
        self.handleServerSync(conflict.serverState);
      }
    };

    return {
      connectToBackend,
      addNodeOptimistic,
      updateNodePositionOptimistic,
      addEdgeOptimistic,
      handleServerSync,
      handleServerUpdate,
      handleRevert,
      handleConflict,
      
      // Override existing actions to use optimistic versions
      afterCreate() {
        // ... existing afterCreate ...
        self.connectToBackend();
      }
    };
  });
```

---

## 3. React Component Updates

### FlowDiagram Component with Optimistic UI

```javascript
// components/FlowDiagram/OptimisticFlowDiagram.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { ReactFlow, useReactFlow } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import { useTreeDaoStore } from '../../stores/StoreProvider';
import { Spinner } from '../UI/Spinner';
import { ConflictModal } from '../UI/ConflictModal';

export const OptimisticFlowDiagram = observer(() => {
  const store = useTreeDaoStore();
  const { fitView } = useReactFlow();
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [currentConflict, setCurrentConflict] = useState(null);

  // Handle node position changes optimistically
  const onNodesChange = useCallback((changes) => {
    changes.forEach(change => {
      if (change.type === 'position' && !change.dragging) {
        // Position finalized - send to backend
        store.updateNodePositionOptimistic(change.id, change.position);
      }
    });
    
    // Apply changes locally immediately
    store.applyChanges(changes, null);
  }, [store]);

  // Handle edge connections optimistically
  const onConnect = useCallback((connection) => {
    // Add edge optimistically
    store.addEdgeOptimistic(connection);
  }, [store]);

  // Handle node deletion optimistically
  const onNodesDelete = useCallback((nodes) => {
    nodes.forEach(node => {
      store.deleteNodeOptimistic(node.id);
    });
  }, [store]);

  // Visual indicators for optimistic updates
  const nodeClassName = useCallback((node) => {
    let className = 'react-flow__node';
    
    if (node.isOptimistic) {
      className += ' optimistic-node';
    }
    
    if (store.optimisticUpdates.has(node.id)) {
      className += ' pending-update';
    }
    
    return className;
  }, [store.optimisticUpdates]);

  // Show sync status
  const SyncIndicator = () => {
    if (store.isSyncing) {
      return (
        <div className="sync-indicator syncing">
          <Spinner size="small" />
          <span>Syncing...</span>
        </div>
      );
    }
    
    if (store.optimisticUpdates.size > 0) {
      return (
        <div className="sync-indicator pending">
          <span className="pending-count">{store.optimisticUpdates.size}</span>
          <span>Pending updates</span>
        </div>
      );
    }
    
    return (
      <div className="sync-indicator synced">
        <span className="checkmark">✓</span>
        <span>Synced</span>
      </div>
    );
  };

  // Handle conflicts
  useEffect(() => {
    const unsubscribe = store.onConflict((conflict) => {
      setCurrentConflict(conflict);
      setShowConflictModal(true);
    });
    
    return unsubscribe;
  }, [store]);

  return (
    <div className="flow-diagram-container">
      <SyncIndicator />
      
      <ReactFlow
        nodes={store.nodes}
        edges={store.edges}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        nodeClassName={nodeClassName}
        fitView
      >
        {/* React Flow components */}
      </ReactFlow>
      
      {showConflictModal && (
        <ConflictModal
          conflict={currentConflict}
          onResolve={(resolution) => {
            store.resolveConflict(currentConflict.id, resolution);
            setShowConflictModal(false);
          }}
          onCancel={() => setShowConflictModal(false)}
        />
      )}
    </div>
  );
});
```

### CSS for Optimistic UI States

```css
/* styles/optimistic-ui.css */

/* Optimistic nodes - slightly transparent */
.optimistic-node {
  opacity: 0.8;
  position: relative;
}

.optimistic-node::after {
  content: '';
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  border: 2px dashed #4CAF50;
  border-radius: 4px;
  animation: pulse 1.5s infinite;
}

/* Pending updates - loading animation */
.pending-update {
  position: relative;
}

.pending-update::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 20px;
  height: 20px;
  border: 2px solid #f3f3f3;
  border-top: 2px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

/* Sync indicator */
.sync-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: white;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  font-size: 14px;
  z-index: 1000;
}

.sync-indicator.syncing {
  background: #FFF3CD;
  color: #856404;
}

.sync-indicator.pending {
  background: #D1ECF1;
  color: #0C5460;
}

.sync-indicator.synced {
  background: #D4EDDA;
  color: #155724;
}

.pending-count {
  background: #007BFF;
  color: white;
  border-radius: 10px;
  padding: 2px 6px;
  font-weight: bold;
  font-size: 12px;
}

/* Animations */
@keyframes pulse {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
  100% {
    opacity: 1;
  }
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* Conflict modal */
.conflict-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: white;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  max-width: 500px;
  z-index: 2000;
}

.conflict-modal h3 {
  margin-top: 0;
  color: #D32F2F;
}

.conflict-resolution-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 20px 0;
}

.resolution-option {
  padding: 12px;
  border: 2px solid #E0E0E0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.resolution-option:hover {
  border-color: #2196F3;
  background: #F5F5F5;
}

.resolution-option.selected {
  border-color: #2196F3;
  background: #E3F2FD;
}
```

---

## 4. Migration Strategy for Frontend

### Phase 1: Parallel Implementation (Week 1)
```javascript
// services/apiAdapter.js
// Adapter to support both old and new API during migration

class APIAdapter {
  constructor() {
    this.useOptimistic = process.env.REACT_APP_USE_OPTIMISTIC === 'true';
    this.oldAPI = new GraphAPI(); // Existing API
    this.newAPI = new OptimisticAPIService(); // New API
  }

  async saveGraph(userId, graphId, data) {
    if (this.useOptimistic) {
      // Use new optimistic API
      return this.newAPI.executeCommand('UPDATE_GRAPH', data);
    } else {
      // Use old API
      return this.oldAPI.saveGraph(userId, graphId, data);
    }
  }

  // Dual write for safety during migration
  async dualWrite(operation, data) {
    try {
      // Write to old system
      await this.oldAPI[operation](data);
    } catch (error) {
      console.error('Old API write failed:', error);
    }

    // Always write to new system
    return this.newAPI.executeCommand(operation, data);
  }
}
```

### Phase 2: Feature Flag Rollout (Week 2)
```javascript
// config/features.js
export const FeatureFlags = {
  OPTIMISTIC_UI: {
    enabled: process.env.REACT_APP_OPTIMISTIC_UI === 'true',
    percentage: 10, // Start with 10% of users
    whitelist: ['beta-user-1', 'beta-user-2'], // Specific test users
  },
  
  shouldEnableOptimistic(userId) {
    // Check whitelist first
    if (this.OPTIMISTIC_UI.whitelist.includes(userId)) {
      return true;
    }
    
    // Check percentage rollout
    if (!this.OPTIMISTIC_UI.enabled) {
      return false;
    }
    
    // Simple hash-based percentage
    const hash = userId.split('').reduce((acc, char) => {
      return acc + char.charCodeAt(0);
    }, 0);
    
    return (hash % 100) < this.OPTIMISTIC_UI.percentage;
  }
};
```

### Phase 3: Performance Monitoring
```javascript
// utils/performanceMonitor.js
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      optimisticSuccess: 0,
      optimisticRevert: 0,
      conflicts: 0,
      averageLatency: 0,
      operations: []
    };
  }

  trackOperation(operationId, type) {
    const operation = {
      id: operationId,
      type,
      startTime: performance.now(),
      endTime: null,
      duration: null,
      status: 'pending'
    };
    
    this.metrics.operations.push(operation);
    return operation;
  }

  completeOperation(operationId, status) {
    const operation = this.metrics.operations.find(op => op.id === operationId);
    if (operation) {
      operation.endTime = performance.now();
      operation.duration = operation.endTime - operation.startTime;
      operation.status = status;
      
      if (status === 'success') {
        this.metrics.optimisticSuccess++;
      } else if (status === 'reverted') {
        this.metrics.optimisticRevert++;
      } else if (status === 'conflict') {
        this.metrics.conflicts++;
      }
      
      // Update average latency
      const completed = this.metrics.operations.filter(op => op.duration);
      this.metrics.averageLatency = 
        completed.reduce((sum, op) => sum + op.duration, 0) / completed.length;
    }
  }

  getReport() {
    const successRate = 
      (this.metrics.optimisticSuccess / this.metrics.operations.length) * 100;
    
    return {
      ...this.metrics,
      successRate: successRate.toFixed(2) + '%',
      p95Latency: this.calculateP95(),
      conflictRate: 
        (this.metrics.conflicts / this.metrics.operations.length * 100).toFixed(2) + '%'
    };
  }

  calculateP95() {
    const durations = this.metrics.operations
      .filter(op => op.duration)
      .map(op => op.duration)
      .sort((a, b) => a - b);
    
    const index = Math.floor(durations.length * 0.95);
    return durations[index] || 0;
  }
}

export const perfMonitor = new PerformanceMonitor();
```

---

## 5. Testing Strategy

### Unit Tests for Optimistic Operations
```javascript
// tests/optimistic.test.js
describe('Optimistic UI Operations', () => {
  let store;
  let mockAPI;
  
  beforeEach(() => {
    store = OptimisticTreeDaoStore.create();
    mockAPI = jest.fn();
    optimisticAPI.executeCommand = mockAPI;
  });
  
  test('should add node optimistically', async () => {
    mockAPI.mockResolvedValue({
      operationId: '123',
      accepted: true
    });
    
    await store.addNodeOptimistic('Test Node', 'dao', { x: 100, y: 100 });
    
    // Node should appear immediately
    expect(store.currentLevel).toHaveLength(1);
    expect(store.currentLevel[0].title).toBe('Test Node');
    expect(store.currentLevel[0].isOptimistic).toBe(true);
  });
  
  test('should revert on failure', async () => {
    mockAPI.mockRejectedValue(new Error('Network error'));
    
    await store.addNodeOptimistic('Test Node', 'dao', { x: 100, y: 100 });
    
    // Node should be removed after failure
    expect(store.currentLevel).toHaveLength(0);
  });
  
  test('should handle conflicts', async () => {
    const conflict = {
      type: 'CONFLICT',
      clientOperation: { /* ... */ },
      serverState: { /* ... */ }
    };
    
    store.handleConflict(conflict);
    
    // Should sync with server state
    expect(store.serverVersion).toBe(conflict.serverState.version);
  });
});
```

---

## 6. Rollback Plan

If issues arise with the optimistic UI:

1. **Immediate Rollback** (< 5 minutes)
   - Toggle feature flag to disable optimistic UI
   - Falls back to synchronous API calls
   - No data loss or user disruption

2. **Partial Rollback** (< 1 hour)
   - Disable specific optimistic operations
   - Keep WebSocket for real-time updates
   - Monitor and fix specific issues

3. **Full Rollback** (if needed)
   - Revert to previous API version
   - Maintain dual-write for data consistency
   - Plan fixes and re-deployment

---

This integration guide provides a complete path for migrating the Graphy frontend to use the new Optimistic UI backend while maintaining stability and the ability to rollback if needed.