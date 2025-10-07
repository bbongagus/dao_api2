import redis from './redis.js';

/**
 * Service for managing historical progress snapshots
 * Used for comparing progress across different time periods
 */
class ProgressSnapshotService {
  constructor() {
    this.retentionDays = 90; // Keep 90 days of history
  }

  /**
   * Get date key in YYYYMMDD format
   */
  getDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Calculate progress for a single node
   */
  async calculateNodeProgress(nodeId, userId = '1', graphId = 'main') {
    // Use correct userId format (just '1' not 'test-user-001')
    let graphKey = `user:${userId}:graph:${graphId}`;
    let graphData = await redis.get(graphKey);
    
    // Fallback to old format
    if (!graphData) {
      graphKey = `user:test-user-001:graph:${graphId}`;
      graphData = await redis.get(graphKey);
    }
    
    if (!graphData) {
      console.log(`No graph data found for user ${userId}, graph ${graphId}`);
      return null;
    }

    const graph = JSON.parse(graphData);
    const node = this.findNode(graph.nodes, nodeId);
    
    if (!node) {
      console.log(`Node ${nodeId} not found in graph`);
      return null;
    }

    // Calculate progress - will use calculatedProgress or fallback for simple DAO
    const progress = this.calculateProgress(node, graph.nodes);
    return progress;
  }

  /**
   * Find node by ID in node tree
   */
  findNode(nodes, nodeId) {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      if (node.children) {
        const found = this.findNode(node.children, nodeId);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Calculate progress - uses saved calculatedProgress from frontend
   * Only fallback for simple DAO nodes
   */
  calculateProgress(node, allNodes) {
    // Use saved calculatedProgress from frontend if available
    if (node.calculatedProgress !== undefined) {
      const percentage = Math.round(node.calculatedProgress * 100);
      return {
        percentage,
        completions: node.currentCompletions || 0,
        total: node.requiredCompletions || 1
      };
    }

    // Fallback ONLY for simple DAO nodes
    if (node.nodeType === 'dao' &&
        (!node.nodeSubtype || node.nodeSubtype === 'simple') &&
        node.requiredCompletions <= 1) {
      const percentage = node.isDone ? 100 : 0;
      return {
        percentage,
        completions: node.isDone ? 1 : 0,
        total: 1
      };
    }

    // For all other nodes - missing data is an error
    console.error('CRITICAL: Missing calculatedProgress', {
      nodeId: node.id,
      nodeType: node.nodeType,
      nodeSubtype: node.nodeSubtype,
      title: node.title,
      hasChildren: node.children?.length > 0,
      linkedNodes: node.linkedNodeIds ? Object.keys(node.linkedNodeIds) : []
    });

    // Return null to indicate missing data
    return null;
  }

  /**
   * Create a snapshot for a single node
   */
  async snapshotNode(nodeId, date = new Date(), userId = '1', graphId = 'main') {
    const progress = await this.calculateNodeProgress(nodeId, userId, graphId);
    
    // Check if progress is valid (not null)
    if (progress === null) {
      console.error(`Cannot create snapshot for node ${nodeId} - missing calculatedProgress`);
      return null;
    }
    
    const dateKey = this.getDateKey(date);
    const snapshotKey = `progress:daily:${nodeId}`;
    
    const snapshot = {
      progress: progress.percentage,
      completions: progress.completions,
      total: progress.total,
      timestamp: date.toISOString(),
      date: dateKey
    };

    // Add to sorted set (score is date in YYYYMMDD format)
    await redis.zadd(snapshotKey, dateKey, JSON.stringify(snapshot));
    
    // Maintain retention window
    const cutoffDate = new Date(date);
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
    const cutoffKey = this.getDateKey(cutoffDate);
    
    await redis.zremrangebyscore(snapshotKey, '-inf', `(${cutoffKey}`);
    
    return snapshot;
  }

  /**
   * Create snapshots for all nodes
   */
  async snapshotAllNodes(date = new Date(), userId = '1', graphId = 'main') {
    // Use correct userId format
    let graphKey = `user:${userId}:graph:${graphId}`;
    let graphData = await redis.get(graphKey);
    
    // Fallback to old format
    if (!graphData) {
      graphKey = `user:test-user-001:graph:${graphId}`;
      graphData = await redis.get(graphKey);
    }
    
    if (!graphData) {
      console.log(`No graph data found at ${graphKey} for snapshots`);
      return [];
    }

    const graph = JSON.parse(graphData);
    console.log(`📊 Found graph with ${graph.nodes?.length || 0} top-level nodes`);
    
    const snapshots = [];
    const processedNodes = new Set(); // Avoid duplicates
    
    // Recursively snapshot all nodes
    const processNodes = async (nodes, level = 0) => {
      const indent = '  '.repeat(level);
      console.log(`${indent}🔄 Processing ${nodes.length} nodes at level ${level}`);
      
      for (const node of nodes) {
        console.log(`${indent}  📌 Node: ${node.title} (${node.id})`);
        
        if (processedNodes.has(node.id)) {
          console.log(`${indent}    ⏭️  Already processed, skipping`);
          continue;
        }
        processedNodes.add(node.id);
        
        const snapshot = await this.snapshotNode(node.id, date, userId, graphId);
        
        if (snapshot === null) {
          console.log(`${indent}    ❌ FAILED - missing calculatedProgress`);
        } else {
          snapshots.push({ nodeId: node.id, title: node.title, ...snapshot });
          console.log(`${indent}    ✅ Created snapshot (progress: ${snapshot.progress}%)`);
        }
        
        // Check if children are objects or IDs
        if (node.children && Array.isArray(node.children) && node.children.length > 0) {
          const firstChild = node.children[0];
          const isNestedObjects = typeof firstChild === 'object' && firstChild !== null && firstChild.id;
          
          console.log(`${indent}    👶 Has ${node.children.length} children (${isNestedObjects ? 'NESTED OBJECTS' : 'IDs'})`);
          
          if (isNestedObjects) {
            // Children are already full node objects
            await processNodes(node.children, level + 1);
          } else {
            // Children are IDs - need to find them
            const childNodes = [];
            for (const childId of node.children) {
              const childNode = this.findNode(graph.nodes, childId);
              if (childNode && !processedNodes.has(childNode.id)) {
                childNodes.push(childNode);
              }
            }
            if (childNodes.length > 0) {
              await processNodes(childNodes, level + 1);
            }
          }
        }
      }
    };

    await processNodes(graph.nodes);
    
    // Check if we have nodes with missing progress
    const nodesWithMissingProgress = [];
    
    // Collect nodes that failed to snapshot
    for (const node of processedNodes) {
      const found = snapshots.find(s => s.nodeId === node);
      if (!found) {
        const nodeData = this.findNode(graph.nodes, node);
        if (nodeData) {
          nodesWithMissingProgress.push({
            id: nodeData.id,
            title: nodeData.title,
            nodeType: nodeData.nodeType,
            nodeSubtype: nodeData.nodeSubtype
          });
        }
      }
    }
    
    if (nodesWithMissingProgress.length > 0) {
      console.error(
        `SNAPSHOT INCOMPLETE for ${graphId}: ${nodesWithMissingProgress.length} nodes missing calculatedProgress`,
        nodesWithMissingProgress
      );
      
      // TODO: Send alert to admin through monitoring service
      // await monitoringService.alert('snapshot_incomplete_data', {
      //   userId,
      //   graphId,
      //   missingCount: nodesWithMissingProgress.length,
      //   nodes: nodesWithMissingProgress
      // });
    }
    
    // Store summary only if we have valid snapshots
    if (snapshots.length > 0) {
      const summaryKey = `snapshots:summary:${this.getDateKey(date)}`;
      await redis.setex(summaryKey, 86400 * 7, JSON.stringify({
        date: date.toISOString(),
        totalNodes: snapshots.length,
        avgProgress: snapshots.reduce((sum, s) => sum + s.progress, 0) / snapshots.length,
        incompleteNodes: nodesWithMissingProgress.length
      }));
    }

    console.log(`✅ Created ${snapshots.length} snapshots for ${date.toISOString()}`);
    if (nodesWithMissingProgress.length > 0) {
      console.log(`⚠️  ${nodesWithMissingProgress.length} nodes skipped due to missing data`);
    }
    return snapshots;
  }

  /**
   * Get snapshot for a specific date
   */
  async getSnapshot(nodeId, date) {
    const dateKey = this.getDateKey(date);
    const snapshotKey = `progress:daily:${nodeId}`;
    
    const snapshot = await redis.zscore(snapshotKey, dateKey);
    if (!snapshot) return null;
    
    try {
      const data = await redis.zrangebyscore(snapshotKey, dateKey, dateKey);
      return data.length > 0 ? JSON.parse(data[0]) : null;
    } catch (e) {
      console.error('Error parsing snapshot:', e);
      return null;
    }
  }

  /**
   * Get progress range for a period
   */
  async getProgressRange(nodeId, startDate, endDate) {
    const snapshotKey = `progress:daily:${nodeId}`;
    const startKey = this.getDateKey(startDate);
    const endKey = this.getDateKey(endDate);
    
    const data = await redis.zrangebyscore(
      snapshotKey, 
      startKey, 
      endKey,
      'WITHSCORES'
    );

    const snapshots = [];
    for (let i = 0; i < data.length; i += 2) {
      try {
        const snapshot = JSON.parse(data[i]);
        snapshot.dateKey = data[i + 1];
        snapshots.push(snapshot);
      } catch (e) {
        console.error('Error parsing snapshot:', e);
      }
    }

    return snapshots;
  }

  /**
   * Calculate average progress for a period
   */
  async getAverageProgress(nodeId, startDate, endDate) {
    const snapshots = await this.getProgressRange(nodeId, startDate, endDate);
    
    if (snapshots.length === 0) return 0;
    
    const sum = snapshots.reduce((acc, s) => acc + s.progress, 0);
    return Math.round(sum / snapshots.length);
  }

  /**
   * Compare current progress with historical point
   */
  async compareProgress(nodeId, periodDays = 30, userId = '1', graphId = 'main') {
    const now = new Date();
    const periodAgo = new Date();
    periodAgo.setDate(periodAgo.getDate() - periodDays);
    
    // Get current progress
    const currentProgress = await this.calculateNodeProgress(nodeId, userId, graphId);
    
    // Get historical snapshot
    const historicalSnapshot = await this.getSnapshot(nodeId, periodAgo);
    
    // If no exact historical snapshot, try to get nearest
    let historicalProgress = 0;
    if (historicalSnapshot) {
      historicalProgress = historicalSnapshot.progress;
    } else {
      // Try to get nearest snapshot within 3 days
      const rangeStart = new Date(periodAgo);
      rangeStart.setDate(rangeStart.getDate() - 3);
      const rangeEnd = new Date(periodAgo);
      rangeEnd.setDate(rangeEnd.getDate() + 3);
      
      const nearbySnapshots = await this.getProgressRange(nodeId, rangeStart, rangeEnd);
      if (nearbySnapshots.length > 0) {
        // Get closest snapshot
        historicalProgress = nearbySnapshots[Math.floor(nearbySnapshots.length / 2)].progress;
      }
    }

    const trend = currentProgress.percentage - historicalProgress;
    
    return {
      nodeId,
      current: currentProgress.percentage,
      historical: historicalProgress,
      trend,
      trendPercentage: historicalProgress > 0 
        ? Math.round((trend / historicalProgress) * 100)
        : 0,
      period: `${periodDays}d`,
      currentDetails: currentProgress,
      hasHistoricalData: historicalSnapshot !== null || historicalProgress > 0
    };
  }

  /**
   * Batch compare progress for multiple nodes
   */
  async batchCompareProgress(nodeIds, periodDays = 30, userId = '1', graphId = 'main') {
    const comparisons = await Promise.all(
      nodeIds.map(nodeId => this.compareProgress(nodeId, periodDays, userId, graphId))
    );
    
    return comparisons;
  }

  /**
   * Get all available snapshots dates for a node
   */
  async getAvailableDates(nodeId) {
    const snapshotKey = `progress:daily:${nodeId}`;
    const data = await redis.zrange(snapshotKey, 0, -1, 'WITHSCORES');
    
    const dates = [];
    for (let i = 1; i < data.length; i += 2) {
      const dateKey = data[i];
      // Convert YYYYMMDD to Date
      const year = dateKey.substring(0, 4);
      const month = dateKey.substring(4, 6);
      const day = dateKey.substring(6, 8);
      dates.push(new Date(`${year}-${month}-${day}`));
    }
    
    return dates;
  }

  /**
   * Clean old snapshots for all nodes
   */
  async cleanOldSnapshots() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
    const cutoffKey = this.getDateKey(cutoffDate);
    
    // Get all snapshot keys
    const keys = await redis.keys('progress:daily:*');
    
    let cleanedCount = 0;
    for (const key of keys) {
      const removed = await redis.zremrangebyscore(key, '-inf', `(${cutoffKey}`);
      if (removed > 0) {
        cleanedCount += removed;
      }
    }
    
    console.log(`Cleaned ${cleanedCount} old snapshots older than ${cutoffDate.toISOString()}`);
    return cleanedCount;
  }
}

// Export singleton instance
export default new ProgressSnapshotService();