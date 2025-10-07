/**
 * Analytics Service for Progress Tracking
 * Собирает и хранит события прогресса для аналитики
 */

const Redis = require('ioredis');

class AnalyticsService {
  constructor(redisClient) {
    this.redis = redisClient || new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
  }

  /**
   * Track a progress event
   */
  async trackEvent(userId, graphId, nodeId, event) {
    try {
      const timestamp = Date.now();
      const eventData = {
        userId,
        graphId,
        nodeId,
        timestamp,
        ...event,
        // Calculate duration if we have a session
        duration: event.sessionStart ? timestamp - event.sessionStart : 0
      };

      // Store in Redis Streams for real-time processing
      const streamKey = `analytics:stream:${userId}:${graphId}`;
      await this.redis.xadd(
        streamKey,
        'MAXLEN', '~', '10000', // Keep last ~10000 events
        '*',
        'event', JSON.stringify(eventData)
      );

      // Update node-specific analytics
      await this.updateNodeAnalytics(userId, graphId, nodeId, event);

      // Update session tracking if needed
      if (event.type === 'session_start') {
        await this.startSession(userId, graphId, nodeId);
      } else if (event.type === 'session_end') {
        await this.endSession(userId, graphId, nodeId);
      }

      console.log(`📊 Analytics: Tracked ${event.type} for node ${nodeId}`);
      return eventData;
    } catch (error) {
      console.error('❌ Analytics: Failed to track event:', error);
      return null;
    }
  }

  /**
   * Update node-specific analytics
   */
  async updateNodeAnalytics(userId, graphId, nodeId, event) {
    const key = `analytics:node:${userId}:${graphId}:${nodeId}`;
    
    // Get current analytics
    const current = await this.redis.hgetall(key);
    const analytics = {
      totalTimeSpent: parseInt(current.totalTimeSpent || 0),
      totalCompletions: parseInt(current.totalCompletions || 0),
      totalSessions: parseInt(current.totalSessions || 0),
      lastActive: current.lastActive || null,
      firstStarted: current.firstStarted || null,
      averageCompletionTime: parseFloat(current.averageCompletionTime || 0),
      currentStreak: parseInt(current.currentStreak || 0),
      bestStreak: parseInt(current.bestStreak || 0)
    };

    const now = new Date().toISOString();

    // Update based on event type
    switch (event.type) {
      case 'progress_update':
        analytics.lastActive = now;
        if (!analytics.firstStarted && event.progress > 0) {
          analytics.firstStarted = now;
        }
        if (event.completed) {
          analytics.totalCompletions++;
          // Update completion time average
          if (event.completionTime) {
            const newAvg = analytics.averageCompletionTime === 0 
              ? event.completionTime
              : (analytics.averageCompletionTime + event.completionTime) / 2;
            analytics.averageCompletionTime = newAvg;
          }
        }
        break;

      case 'session_start':
        analytics.totalSessions++;
        analytics.lastActive = now;
        if (!analytics.firstStarted) {
          analytics.firstStarted = now;
        }
        break;

      case 'session_end':
        if (event.duration) {
          analytics.totalTimeSpent += event.duration;
        }
        break;

      case 'streak_update':
        analytics.currentStreak = event.currentStreak || 0;
        if (analytics.currentStreak > analytics.bestStreak) {
          analytics.bestStreak = analytics.currentStreak;
        }
        break;
    }

    // Save updated analytics
    await this.redis.hmset(key, analytics);
    
    // Set expiry for 90 days
    await this.redis.expire(key, 90 * 24 * 60 * 60);
  }

  /**
   * Start a work session
   */
  async startSession(userId, graphId, nodeId) {
    const sessionKey = `session:${userId}:${graphId}:${nodeId}`;
    const sessionData = {
      startTime: Date.now(),
      userId,
      graphId,
      nodeId,
      active: 'true'
    };
    
    await this.redis.hmset(sessionKey, sessionData);
    await this.redis.expire(sessionKey, 24 * 60 * 60); // Expire after 24 hours
    
    console.log(`⏱️ Session started for node ${nodeId}`);
    return sessionData;
  }

  /**
   * End a work session
   */
  async endSession(userId, graphId, nodeId) {
    const sessionKey = `session:${userId}:${graphId}:${nodeId}`;
    const session = await this.redis.hgetall(sessionKey);
    
    if (session && session.active === 'true') {
      const duration = Date.now() - parseInt(session.startTime);
      
      // Mark session as ended
      await this.redis.hset(sessionKey, 'active', 'false');
      await this.redis.hset(sessionKey, 'endTime', Date.now());
      await this.redis.hset(sessionKey, 'duration', duration);
      
      console.log(`⏹️ Session ended for node ${nodeId}, duration: ${Math.round(duration / 1000)}s`);
      return { duration };
    }
    
    return null;
  }

  /**
   * Get analytics for a specific node
   */
  async getNodeAnalytics(userId, graphId, nodeId) {
    const key = `analytics:node:${userId}:${graphId}:${nodeId}`;
    const analytics = await this.redis.hgetall(key);
    
    // Convert string values to appropriate types
    if (analytics.totalTimeSpent) {
      analytics.totalTimeSpent = parseInt(analytics.totalTimeSpent);
      analytics.formattedTime = this.formatDuration(analytics.totalTimeSpent);
    }
    if (analytics.totalCompletions) {
      analytics.totalCompletions = parseInt(analytics.totalCompletions);
    }
    if (analytics.totalSessions) {
      analytics.totalSessions = parseInt(analytics.totalSessions);
    }
    if (analytics.averageCompletionTime) {
      analytics.averageCompletionTime = parseFloat(analytics.averageCompletionTime);
    }
    if (analytics.currentStreak) {
      analytics.currentStreak = parseInt(analytics.currentStreak);
    }
    if (analytics.bestStreak) {
      analytics.bestStreak = parseInt(analytics.bestStreak);
    }
    
    return analytics;
  }

  /**
   * Get analytics for entire graph
   */
  async getGraphAnalytics(userId, graphId, timeRange = '7d') {
    try {
      // First, get the actual graph to count all nodes
      const graphKey = `user:${userId}:graph:${graphId}`;
      let graphData = await this.redis.get(graphKey);
      
      // Fallback to old key format
      if (!graphData) {
        graphData = await this.redis.get(`graph:${graphId}`);
      }
      
      let totalNodesInGraph = 0;
      let completedNodesInGraph = 0;
      let activeNodesInGraph = 0;
      let totalProgressSum = 0;
      
      if (graphData) {
        const graph = JSON.parse(graphData);
        
        // Recursively count all nodes in the graph
        const countNodesRecursive = (nodes) => {
          for (const node of nodes) {
            totalNodesInGraph++;
            
            // Calculate progress for this node
            let nodeProgress = 0;
            if (node.nodeType === 'dao') {
              if (node.isDone) {
                completedNodesInGraph++;
                nodeProgress = 1;
              } else if (node.requiredCompletions > 0 && node.currentCompletions > 0) {
                activeNodesInGraph++;
                nodeProgress = node.currentCompletions / node.requiredCompletions;
              }
            } else if (node.nodeType === 'fundamental') {
              // For fundamental nodes, use calculatedProgress if available
              nodeProgress = node.calculatedProgress || 0;
              if (nodeProgress >= 1) {
                completedNodesInGraph++;
              } else if (nodeProgress > 0) {
                activeNodesInGraph++;
              }
            }
            
            totalProgressSum += nodeProgress;
            
            // Count children recursively
            if (node.children && node.children.length > 0) {
              countNodesRecursive(node.children);
            }
          }
        };
        
        if (graph.nodes && graph.nodes.length > 0) {
          countNodesRecursive(graph.nodes);
        }
      }
      
      // Get all node analytics for this graph
      const pattern = `analytics:node:${userId}:${graphId}:*`;
      const nodeKeys = await this.redis.keys(pattern);
      
      const aggregated = {
        totalNodes: totalNodesInGraph, // Use real count from graph
        activeNodes: activeNodesInGraph, // Use real active count
        completedNodes: completedNodesInGraph, // Use real completed count
        totalTimeSpent: 0,
        totalSessions: 0,
        averageProgress: totalNodesInGraph > 0 ? totalProgressSum / totalNodesInGraph : 0,
        timeDistribution: [],
        progressOverTime: [],
        topNodes: [],
        insights: []
      };

      // Aggregate analytics data (time spent, sessions, etc.)
      for (const key of nodeKeys) {
        const nodeData = await this.redis.hgetall(key);
        const nodeId = key.split(':').pop();
        
        aggregated.totalTimeSpent += parseInt(nodeData.totalTimeSpent || 0);
        aggregated.totalSessions += parseInt(nodeData.totalSessions || 0);
        
        // Add to top nodes if has significant time
        if (nodeData.totalTimeSpent > 0) {
          aggregated.topNodes.push({
            nodeId,
            timeSpent: parseInt(nodeData.totalTimeSpent),
            completions: parseInt(nodeData.totalCompletions || 0),
            lastActive: nodeData.lastActive
          });
        }
      }

      // Sort top nodes by time spent
      aggregated.topNodes.sort((a, b) => b.timeSpent - a.timeSpent);
      aggregated.topNodes = aggregated.topNodes.slice(0, 10);

      // Generate insights
      aggregated.insights = this.generateInsights(aggregated);

      // Format time
      aggregated.formattedTotalTime = this.formatDuration(aggregated.totalTimeSpent);

      // Get recent events for progress over time
      aggregated.progressOverTime = await this.getProgressOverTime(userId, graphId, timeRange);

      console.log(`📊 Graph analytics compiled for ${graphId}:`);
      console.log(`   Total nodes in graph: ${aggregated.totalNodes}`);
      console.log(`   Active nodes: ${aggregated.activeNodes}`);
      console.log(`   Completed nodes: ${aggregated.completedNodes}`);
      console.log(`   Average progress: ${(aggregated.averageProgress * 100).toFixed(1)}%`);
      
      return aggregated;
    } catch (error) {
      console.error('❌ Failed to get graph analytics:', error);
      return null;
    }
  }

  /**
   * Get progress over time from event stream
   */
  async getProgressOverTime(userId, graphId, timeRange = '7d') {
    const streamKey = `analytics:stream:${userId}:${graphId}`;
    
    // Calculate time range
    const now = Date.now();
    const ranges = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    const rangeMs = ranges[timeRange] || ranges['7d'];
    const startTime = now - rangeMs;
    
    // Read events from stream
    const events = await this.redis.xrange(
      streamKey,
      startTime,
      '+',
      'COUNT', 1000
    );
    
    // Group events by day/hour
    const grouped = {};
    const interval = timeRange === '24h' ? 'hour' : 'day';
    
    events.forEach(([id, fields]) => {
      const event = JSON.parse(fields[1]); // fields is ['event', jsonString]
      const date = new Date(event.timestamp);
      
      let key;
      if (interval === 'hour') {
        key = `${date.getHours()}:00`;
      } else {
        key = date.toISOString().split('T')[0];
      }
      
      if (!grouped[key]) {
        grouped[key] = {
          time: key,
          events: 0,
          completions: 0,
          progressUpdates: 0
        };
      }
      
      grouped[key].events++;
      if (event.type === 'progress_update') {
        grouped[key].progressUpdates++;
        if (event.completed) {
          grouped[key].completions++;
        }
      }
    });
    
    // Convert to array and sort
    return Object.values(grouped).sort((a, b) => 
      a.time.localeCompare(b.time)
    );
  }

  /**
   * Generate insights from analytics data
   */
  generateInsights(analytics) {
    const insights = [];
    
    // Productivity insights
    if (analytics.totalSessions > 0) {
      const avgSessionTime = analytics.totalTimeSpent / analytics.totalSessions;
      if (avgSessionTime < 5 * 60 * 1000) { // Less than 5 minutes
        insights.push({
          type: 'warning',
          message: 'Short average session time. Consider longer focused work periods.',
          metric: this.formatDuration(avgSessionTime)
        });
      } else if (avgSessionTime > 2 * 60 * 60 * 1000) { // More than 2 hours
        insights.push({
          type: 'success',
          message: 'Excellent focus! Long work sessions indicate deep work.',
          metric: this.formatDuration(avgSessionTime)
        });
      }
    }
    
    // Completion rate insights
    if (analytics.totalNodes > 0) {
      const completionRate = (analytics.completedNodes / analytics.totalNodes) * 100;
      if (completionRate < 20) {
        insights.push({
          type: 'info',
          message: 'Low completion rate. Consider breaking down complex tasks.',
          metric: `${completionRate.toFixed(1)}%`
        });
      } else if (completionRate > 80) {
        insights.push({
          type: 'success',
          message: 'High completion rate! Great progress on your goals.',
          metric: `${completionRate.toFixed(1)}%`
        });
      }
    }
    
    // Activity insights
    const activeRate = analytics.totalNodes > 0 
      ? (analytics.activeNodes / analytics.totalNodes) * 100 
      : 0;
    
    if (activeRate < 30) {
      insights.push({
        type: 'warning',
        message: 'Many inactive nodes. Consider reviewing your priorities.',
        metric: `${activeRate.toFixed(1)}% active`
      });
    }
    
    // Time distribution insights
    if (analytics.topNodes.length > 0) {
      const topNode = analytics.topNodes[0];
      const topNodePercentage = (topNode.timeSpent / analytics.totalTimeSpent) * 100;
      if (topNodePercentage > 50) {
        insights.push({
          type: 'info',
          message: `Most time spent on one task. Consider if this aligns with priorities.`,
          metric: `${topNodePercentage.toFixed(1)}% on top task`
        });
      }
    }
    
    return insights;
  }

  /**
   * Format duration in milliseconds to human readable
   */
  formatDuration(ms) {
    if (!ms || ms === 0) return '0m';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Clean up old analytics data
   */
  async cleanupOldData(daysToKeep = 90) {
    try {
      // Find and delete old streams
      const streamPattern = `analytics:stream:*`;
      const streams = await this.redis.keys(streamPattern);
      
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
      
      for (const stream of streams) {
        // Trim stream to remove old entries
        await this.redis.xtrim(stream, 'MINID', cutoffTime);
      }
      
      console.log(`🧹 Cleaned up analytics data older than ${daysToKeep} days`);
    } catch (error) {
      console.error('❌ Failed to cleanup old analytics:', error);
    }
  }

  /**
   * Get category-based analytics with trends
   */
  async getCategoryAnalytics(userId, graphId, period = '7d') {
    try {
      const graphKey = `user:${userId}:graph:${graphId}`;
      const graphData = await this.redis.get(graphKey);
      
      if (!graphData) return [];
      
      const graph = JSON.parse(graphData);
      const categories = [];
      
      // Helper function to find category nodes
      const processNode = async (node, path = []) => {
        if (node.nodeType === 'fundamental' && node.nodeSubtype === 'category') {
          // Get historical data for trend calculation
          const previousPeriodData = await this.getPreviousPeriodProgress(
            userId, graphId, node.id, period
          );
          
          const currentProgress = node.calculatedProgress || 0;
          const previousProgress = previousPeriodData || 0;
          const trend = this.calculateTrend(currentProgress, previousProgress);
          
          // Get node-specific analytics
          const nodeAnalytics = await this.getNodeAnalytics(userId, graphId, node.id);
          
          categories.push({
            id: node.id,
            name: node.title || node.name,
            emoji: node.emoji || '🎯',
            progress: Math.round(currentProgress * 100),
            trend: Math.abs(trend),
            trendDirection: trend > 0 ? 'up' : trend < 0 ? 'down' : 'stable',
            periodLabel: this.getPeriodLabel(period),
            lastActive: nodeAnalytics.lastActive,
            totalTime: nodeAnalytics.totalTimeSpent || 0,
            sessions: nodeAnalytics.totalSessions || 0,
            completions: node.children?.filter(c => c.isDone).length || 0,
            totalTasks: node.children?.length || 0
          });
        }
        
        // Process children recursively
        if (node.children && node.children.length > 0) {
          for (const child of node.children) {
            await processNode(child, [...path, node.id]);
          }
        }
      };
      
      // Process all root nodes
      if (graph.nodes && graph.nodes.length > 0) {
        for (const node of graph.nodes) {
          await processNode(node);
        }
      }
      
      // Sort by progress descending
      return categories.sort((a, b) => b.progress - a.progress);
    } catch (error) {
      console.error('Failed to get category analytics:', error);
      return [];
    }
  }

  /**
   * Calculate trend between two progress values
   */
  calculateTrend(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  /**
   * Get previous period progress for trend calculation
   */
  async getPreviousPeriodProgress(userId, graphId, nodeId, period) {
    const streamKey = `analytics:stream:${userId}:${graphId}`;
    const periodMs = this.parsePeriod(period);
    const previousStart = Date.now() - (periodMs * 2);
    const previousEnd = Date.now() - periodMs;
    
    // Read events from previous period
    const events = await this.redis.xrange(
      streamKey,
      previousStart,
      previousEnd
    );
    
    // Find last progress update in previous period
    let lastProgress = 0;
    events.forEach(([id, fields]) => {
      const event = JSON.parse(fields[1]);
      if (event.nodeId === nodeId && event.type === 'progress_update') {
        lastProgress = event.progress || 0;
      }
    });
    
    return lastProgress;
  }

  /**
   * Get recent activity focus with detailed metrics
   */
  async getRecentActivityFocus(userId, graphId, period = '7d', limit = 5) {
    try {
      const streamKey = `analytics:stream:${userId}:${graphId}`;
      const cutoff = Date.now() - this.parsePeriod(period);
      
      // Get events from stream
      const events = await this.redis.xrange(streamKey, cutoff, '+');
      
      // Aggregate by node
      const nodeActivity = new Map();
      
      events.forEach(([id, fields]) => {
        const event = JSON.parse(fields[1]);
        
        if (!nodeActivity.has(event.nodeId)) {
          nodeActivity.set(event.nodeId, {
            nodeId: event.nodeId,
            focusCount: 0,
            progressUpdates: 0,
            completions: 0,
            totalTime: 0,
            lastActivity: event.timestamp,
            sessions: []
          });
        }
        
        const activity = nodeActivity.get(event.nodeId);
        
        switch(event.type) {
          case 'node_focus':
            activity.focusCount++;
            break;
          case 'progress_update':
            activity.progressUpdates++;
            if (event.completed) activity.completions++;
            break;
          case 'session_end':
            if (event.duration) {
              activity.totalTime += event.duration;
              activity.sessions.push({
                duration: event.duration,
                timestamp: event.timestamp
              });
            }
            break;
        }
        
        activity.lastActivity = Math.max(activity.lastActivity, event.timestamp);
      });
      
      // Get graph for node details
      const graphKey = `user:${userId}:graph:${graphId}`;
      const graphData = await this.redis.get(graphKey);
      if (!graphData) return [];
      
      const graph = JSON.parse(graphData);
      const enrichedNodes = [];
      
      // Find nodes in graph and enrich data
      for (const [nodeId, activity] of nodeActivity.entries()) {
        const node = this.findNodeInGraph(graph, nodeId);
        if (node) {
          const category = this.findNodeCategory(graph, node);
          
          enrichedNodes.push({
            id: nodeId,
            title: node.title || node.name,
            emoji: node.emoji || '📋',
            progress: Math.round((node.calculatedProgress || 0) * 100),
            tasksCompleted: activity.completions,
            tasksAdvanced: activity.progressUpdates,
            focusTime: this.formatDuration(activity.totalTime),
            focusTimeMs: activity.totalTime,
            lastActivity: new Date(activity.lastActivity).toISOString(),
            hoursAgo: Math.round((Date.now() - activity.lastActivity) / (1000 * 60 * 60)),
            status: this.determineActivityStatus(activity, node),
            category: category ? category.title || category.name : 'Uncategorized',
            nodeType: node.nodeType,
            nodeSubtype: node.nodeSubtype || null
          });
        }
      }
      
      // Sort by last activity and return top N
      return enrichedNodes
        .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
        .slice(0, limit);
    } catch (error) {
      console.error('Failed to get recent activity focus:', error);
      return [];
    }
  }

  /**
   * Find node in graph recursively
   */
  findNodeInGraph(graph, nodeId) {
    const searchNode = (nodes) => {
      for (const node of nodes) {
        if (node.id === nodeId) return node;
        if (node.children) {
          const found = searchNode(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    
    return searchNode(graph.nodes || []);
  }

  /**
   * Find category for a node
   */
  findNodeCategory(graph, targetNode) {
    const searchCategory = (nodes, parent = null) => {
      for (const node of nodes) {
        if (node.id === targetNode.id) {
          // Walk up to find category
          if (parent && parent.nodeType === 'fundamental' && parent.nodeSubtype === 'category') {
            return parent;
          }
        }
        if (node.children) {
          const found = searchCategory(node.children, node);
          if (found) return found;
        }
      }
      return null;
    };
    
    return searchCategory(graph.nodes || []);
  }

  /**
   * Determine activity status based on metrics
   */
  determineActivityStatus(activity, node) {
    const hoursSinceActive = (Date.now() - activity.lastActivity) / (1000 * 60 * 60);
    
    if (node.isDone) return 'Completed';
    if (hoursSinceActive < 1) return 'Most active path';
    if (activity.progressUpdates > 5) return 'Steady progress';
    if (activity.completions > 0) return 'Making progress';
    if (hoursSinceActive > 24 * 7) return 'On hold';
    return 'In progress';
  }

  /**
   * Get effort distribution across categories
   */
  async getEffortDistribution(userId, graphId, period = '7d') {
    try {
      const categories = await this.getCategoryAnalytics(userId, graphId, period);
      
      // Calculate total effort
      const totalEffort = categories.reduce((sum, cat) => sum + cat.totalTime, 0);
      
      // Calculate distribution
      const distribution = categories.map(cat => ({
        name: cat.name,
        value: totalEffort > 0 ? (cat.totalTime / totalEffort) * 100 : 0,
        time: cat.totalTime,
        formattedTime: this.formatDuration(cat.totalTime),
        progress: cat.progress,
        color: this.getCategoryColor(cat.name)
      }));
      
      // Calculate allocated percentage (weighted by progress)
      const allocatedSum = categories.reduce((sum, cat) =>
        sum + (cat.progress * (cat.totalTasks || 1)), 0
      );
      const totalTasks = categories.reduce((sum, cat) =>
        sum + (cat.totalTasks || 1), 0
      );
      const allocatedPercentage = totalTasks > 0 ? allocatedSum / (totalTasks * 100) : 0;
      
      return {
        allocated: Math.round(allocatedPercentage * 100),
        unallocated: Math.round((1 - allocatedPercentage) * 100),
        categories: distribution,
        totalTime: totalEffort,
        formattedTotalTime: this.formatDuration(totalEffort),
        periodLabel: this.getPeriodLabel(period)
      };
    } catch (error) {
      console.error('Failed to get effort distribution:', error);
      return {
        allocated: 0,
        unallocated: 100,
        categories: [],
        totalTime: 0,
        formattedTotalTime: '0h'
      };
    }
  }

  /**
   * Get nodes approaching completion
   */
  async getNodesApproachingCompletion(userId, graphId, threshold = 0.7) {
    try {
      const graphKey = `user:${userId}:graph:${graphId}`;
      const graphData = await this.redis.get(graphKey);
      
      if (!graphData) return [];
      
      const graph = JSON.parse(graphData);
      const nearComplete = [];
      
      const processNode = (node, path = []) => {
        const progress = node.calculatedProgress ||
          (node.currentCompletions / (node.requiredCompletions || 1));
        
        // Check if node is near completion but not done
        if (progress >= threshold && progress < 1 && !node.isDone) {
          nearComplete.push({
            id: node.id,
            title: node.title || node.name,
            emoji: node.emoji || '📋',
            progress: Math.round(progress * 100),
            path: path.map(p => p.title || p.name).join(' > '),
            remainingSteps: this.calculateRemainingSteps(node),
            nodeType: node.nodeType,
            category: path.find(p =>
              p.nodeType === 'fundamental' && p.nodeSubtype === 'category'
            )?.title || 'Uncategorized',
            unlocks: this.findUnlockedNodes(graph, node)
          });
        }
        
        // Process children
        if (node.children && node.children.length > 0) {
          node.children.forEach(child =>
            processNode(child, [...path, node])
          );
        }
      };
      
      // Process all nodes
      if (graph.nodes && graph.nodes.length > 0) {
        graph.nodes.forEach(node => processNode(node));
      }
      
      // Sort by progress (highest first)
      return nearComplete
        .sort((a, b) => b.progress - a.progress)
        .slice(0, 10); // Limit to top 10
    } catch (error) {
      console.error('Failed to get nodes approaching completion:', error);
      return [];
    }
  }

  /**
   * Calculate remaining steps for a node
   */
  calculateRemainingSteps(node) {
    if (node.nodeType === 'dao' && node.requiredCompletions) {
      return Math.max(0, node.requiredCompletions - (node.currentCompletions || 0));
    }
    
    if (node.children && node.children.length > 0) {
      return node.children.filter(c => !c.isDone).length;
    }
    
    return 1;
  }

  /**
   * Find what nodes would be unlocked
   */
  findUnlockedNodes(graph, completedNode) {
    // This is a simplified version - in reality you'd check dependencies
    const unlocks = [];
    
    // For now, just return sibling count as potential unlocks
    if (completedNode.children) {
      unlocks.push(`${completedNode.children.length} subtasks`);
    }
    
    return unlocks;
  }

  /**
   * Parse period string to milliseconds
   */
  parsePeriod(period) {
    const periods = {
      'Today': 24 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      'All': 365 * 24 * 60 * 60 * 1000 // 1 year for "all time"
    };
    return periods[period] || periods['7d'];
  }

  /**
   * Get period label for display
   */
  getPeriodLabel(period) {
    const labels = {
      'Today': 'today',
      '24h': 'today',
      '7d': 'this week',
      '30d': 'this month',
      'All': 'all time'
    };
    return labels[period] || 'this week';
  }

  /**
   * Get consistent color for category
   */
  getCategoryColor(categoryName) {
    // Hash-based color selection for consistency
    const colors = [
      '#14FFE1', // Jade
      '#9333EA', // Purple
      '#FF8C00', // Amber
      '#3B82F6', // Blue
      '#10B981', // Green
      '#EC4899'  // Pink
    ];
    
    let hash = 0;
    for (let i = 0; i < categoryName.length; i++) {
      hash = categoryName.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    return colors[Math.abs(hash) % colors.length];
  }
}

module.exports = AnalyticsService;