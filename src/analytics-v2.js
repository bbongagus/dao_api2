/**
 * Simplified Analytics Service v2
 * Tracks only progress events and maintains aggregates
 */

import Redis from 'ioredis';

class SimplifiedAnalytics {
  constructor(redisClient) {
    this.redis = redisClient || new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
  }

  /**
   * Track progress update event
   * Called from WebSocket handler when progress changes
   */
  async trackProgressUpdate(userId, graphId, nodeId, eventData) {
    try {
      const timestamp = Date.now();
      
      // Build progress event
      const event = {
        timestamp,
        userId,
        graphId,
        nodeId,
        nodePath: eventData.nodePath || [],
        nodeTitle: eventData.nodeTitle || '',
        nodeType: eventData.nodeType || 'dao',
        nodeSubtype: eventData.nodeSubtype || null,
        categoryId: eventData.categoryId || null,
        categoryName: eventData.categoryName || null,
        
        // Progress data
        previousProgress: eventData.previousProgress || 0,
        currentProgress: eventData.currentProgress || 0,
        isDone: eventData.isDone || false,
        currentCompletions: eventData.currentCompletions || 0,
        requiredCompletions: eventData.requiredCompletions || 1
      };

      // 1. Store in event stream for history
      const streamKey = `analytics:events:${userId}:${graphId}`;
      await this.redis.xadd(
        streamKey,
        'MAXLEN', '~', '50000', // Keep last ~50k events
        '*',
        'data', JSON.stringify(event)
      );

      // 2. Update aggregates
      await this.updateAggregates(userId, graphId, event);

      // 3. If node completed, add to completed list
      if (event.isDone && !eventData.previousIsDone) {
        await this.addCompletedNode(userId, graphId, nodeId, event);
      }

      console.log(`📊 Analytics: Progress tracked for node ${nodeId} (${event.currentProgress}%)`);
      return event;
    } catch (error) {
      console.error('❌ Analytics: Failed to track progress:', error);
      return null;
    }
  }

  /**
   * Update aggregate data
   */
  async updateAggregates(userId, graphId, event) {
    // Update category aggregates if node belongs to a category
    if (event.categoryId) {
      const categoryKey = `analytics:category:${userId}:${graphId}:${event.categoryId}`;
      
      // Get current category data
      const categoryData = await this.redis.hgetall(categoryKey) || {};
      
      // Update progress tracking
      const nodeProgressKey = `${categoryKey}:nodes`;
      await this.redis.hset(nodeProgressKey, event.nodeId, event.currentProgress);
      
      // Calculate category progress (average of all nodes)
      const allNodeProgress = await this.redis.hgetall(nodeProgressKey);
      const progressValues = Object.values(allNodeProgress).map(p => parseFloat(p));
      const avgProgress = progressValues.length > 0
        ? progressValues.reduce((a, b) => a + b, 0) / progressValues.length
        : 0;
      
      // Count completed tasks
      const completedCount = progressValues.filter(p => p >= 100).length;
      
      // Update category aggregate
      await this.redis.hmset(categoryKey, {
        name: event.categoryName || categoryData.name || 'Unknown',
        progress: avgProgress,
        completedTasks: completedCount,
        totalTasks: progressValues.length,
        lastUpdated: event.timestamp
      });
      
      // Set TTL
      await this.redis.expire(categoryKey, 90 * 24 * 60 * 60); // 90 days
      await this.redis.expire(nodeProgressKey, 90 * 24 * 60 * 60);
    }

    // Update graph-level aggregate
    const graphKey = `analytics:graph:${userId}:${graphId}`;
    await this.redis.hincrby(graphKey, 'totalProgressEvents', 1);
    await this.redis.hset(graphKey, 'lastActivity', event.timestamp);
    await this.redis.expire(graphKey, 90 * 24 * 60 * 60);
  }

  /**
   * Add node to completed list
   */
  async addCompletedNode(userId, graphId, nodeId, event) {
    const completedKey = `analytics:completed:${userId}:${graphId}`;
    
    // Add to sorted set with timestamp as score
    await this.redis.zadd(completedKey, event.timestamp, JSON.stringify({
      nodeId,
      title: event.nodeTitle,
      nodeType: event.nodeType,
      categoryName: event.categoryName,
      completedAt: event.timestamp
    }));
    
    // Keep only last 1000 completed nodes
    await this.redis.zremrangebyrank(completedKey, 0, -1001);
    await this.redis.expire(completedKey, 90 * 24 * 60 * 60);
  }

  /**
   * Get analytics for a graph with optional context filtering
   */
  async getAnalytics(userId, graphId, options = {}) {
    const { period = 'all', contextNodeId = null } = options;
    
    try {
      // 1. Get graph data for context filtering
      const graphKey = `user:${userId}:graph:${graphId}`;
      const graphData = await this.redis.get(graphKey);
      
      if (!graphData) {
        return this.getEmptyAnalytics();
      }
      
      const graph = JSON.parse(graphData);
      
      // 2. Filter nodes based on context
      let relevantNodes = [];
      if (contextNodeId) {
        // Find context node and get all its descendants
        const contextNode = this.findNodeInGraph(graph.nodes, contextNodeId);
        if (contextNode) {
          relevantNodes = this.getAllDescendants(contextNode);
        }
      } else {
        // Use all nodes in graph
        relevantNodes = this.getAllNodesFlat(graph.nodes);
      }
      
      // 3. Calculate analytics from relevant nodes
      const analytics = {
        completedNodes: [],
        categoryProgress: [],
        distribution: {},
        totalNodes: relevantNodes.length,
        completedCount: 0,
        averageProgress: 0
      };
      
      // Process each node
      let totalProgress = 0;
      const categoriesMap = new Map();
      
      for (const node of relevantNodes) {
        // Track completion
        if (node.isDone) {
          analytics.completedCount++;
          analytics.completedNodes.push({
            id: node.id,
            title: node.title || node.name,
            nodeType: node.nodeType,
            completedAt: node.lastUpdated || Date.now()
          });
        }
        
        // Calculate progress
        let nodeProgress = 0;
        if (node.nodeType === 'dao') {
          if (node.isDone) {
            nodeProgress = 100;
          } else if (node.requiredCompletions > 0) {
            nodeProgress = (node.currentCompletions / node.requiredCompletions) * 100;
          }
        } else if (node.nodeType === 'fundamental') {
          nodeProgress = (node.calculatedProgress || 0) * 100;
        }
        totalProgress += nodeProgress;
        
        // Track categories
        if (node.nodeType === 'fundamental' && node.nodeSubtype === 'category') {
          categoriesMap.set(node.id, {
            id: node.id,
            name: node.title || node.name,
            emoji: node.emoji || '🎯',
            progress: Math.round(nodeProgress),
            completedTasks: node.children?.filter(c => c.isDone).length || 0,
            totalTasks: node.children?.length || 0
          });
        }
      }
      
      // Calculate averages
      analytics.averageProgress = relevantNodes.length > 0
        ? Math.round(totalProgress / relevantNodes.length)
        : 0;
      
      // Convert categories map to array
      analytics.categoryProgress = Array.from(categoriesMap.values())
        .sort((a, b) => b.progress - a.progress);
      
      // Calculate distribution (percentage by category)
      if (analytics.categoryProgress.length > 0) {
        const total = analytics.categoryProgress.reduce((sum, cat) => sum + (cat.totalTasks || 1), 0);
        analytics.distribution = {
          categories: analytics.categoryProgress.map(cat => ({
            name: cat.name,
            percentage: Math.round(((cat.totalTasks || 1) / total) * 100),
            progress: cat.progress,
            emoji: cat.emoji
          }))
        };
      }
      
      // Get completed nodes from Redis
      const completedKey = `analytics:completed:${userId}:${graphId}`;
      const completedFromRedis = await this.redis.zrevrange(completedKey, 0, 19, 'WITHSCORES');
      
      if (completedFromRedis && completedFromRedis.length > 0) {
        analytics.completedNodes = [];
        for (let i = 0; i < completedFromRedis.length; i += 2) {
          try {
            const data = JSON.parse(completedFromRedis[i]);
            analytics.completedNodes.push(data);
          } catch (e) {
            // Skip invalid entries
          }
        }
      }
      
      return analytics;
    } catch (error) {
      console.error('Failed to get analytics:', error);
      return this.getEmptyAnalytics();
    }
  }

  /**
   * Get category analytics for display cards
   */
  async getCategoryAnalytics(userId, graphId, contextNodeId = null) {
    try {
      const analytics = await this.getAnalytics(userId, graphId, { contextNodeId });
      
      // Enhance category data with trends (for now, mock trends for MVP)
      return analytics.categoryProgress.map(cat => ({
        ...cat,
        trend: Math.floor(Math.random() * 40 - 10), // Mock: -10% to +30%
        trendDirection: 'up', // For MVP, always show as improving
        periodLabel: 'all time'
      }));
    } catch (error) {
      console.error('Failed to get category analytics:', error);
      return [];
    }
  }

  /**
   * Helper: Find node in graph recursively
   */
  findNodeInGraph(nodes, nodeId) {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      if (node.children) {
        const found = this.findNodeInGraph(node.children, nodeId);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Helper: Get all descendant nodes
   */
  getAllDescendants(node) {
    const descendants = [node];
    if (node.children) {
      for (const child of node.children) {
        descendants.push(...this.getAllDescendants(child));
      }
    }
    return descendants;
  }

  /**
   * Helper: Flatten all nodes
   */
  getAllNodesFlat(nodes) {
    const flat = [];
    for (const node of nodes) {
      flat.push(node);
      if (node.children) {
        flat.push(...this.getAllNodesFlat(node.children));
      }
    }
    return flat;
  }

  /**
   * Helper: Get empty analytics object
   */
  getEmptyAnalytics() {
    return {
      completedNodes: [],
      categoryProgress: [],
      distribution: {},
      totalNodes: 0,
      completedCount: 0,
      averageProgress: 0
    };
  }

  /**
   * Find category parent for a node
   */
  findNodeCategory(graph, targetNodeId) {
    const searchWithParent = (nodes, parent = null) => {
      for (const node of nodes) {
        if (node.id === targetNodeId) {
          // Found target, return parent if it's a category
          if (parent && parent.nodeType === 'fundamental' && parent.nodeSubtype === 'category') {
            return parent;
          }
        }
        if (node.children) {
          const found = searchWithParent(node.children, node);
          if (found) return found;
        }
      }
      return null;
    };
    
    return searchWithParent(graph.nodes || []);
  }

  /**
   * Build node path from root to node
   */
  getNodePath(graph, targetNodeId) {
    const path = [];
    
    const searchPath = (nodes, currentPath = []) => {
      for (const node of nodes) {
        const newPath = [...currentPath, node.id];
        if (node.id === targetNodeId) {
          return newPath;
        }
        if (node.children) {
          const found = searchPath(node.children, newPath);
          if (found) return found;
        }
      }
      return null;
    };
    
    return searchPath(graph.nodes || []) || [];
  }
}

export default SimplifiedAnalytics;