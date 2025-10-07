# 🚀 Advanced Analytics Implementation Plan

## Executive Summary
Enhance the existing AdaptiveDashboard with advanced analytics features while leveraging current analyticsService and backend infrastructure.

## Phase 1: Backend Analytics Extensions (Day 1)

### 1.1 Extend dao_api2/src/analytics.js

```javascript
// Add to existing AnalyticsService class

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
```

### 1.2 Add new API endpoints to dao_api2/src/simple-server.js

```javascript
// Category analytics with trends
app.get('/api/analytics/categories/:graphId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    const period = req.query.period || '7d';
    
    const categories = await analytics.getCategoryAnalytics(userId, req.params.graphId, period);
    
    res.json({
      success: true,
      data: categories,
      period: period
    });
  } catch (error) {
    console.error('Error in categories endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get category analytics'
    });
  }
});

// Recent activity focus
app.get('/api/analytics/recent-focus/:graphId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    const period = req.query.period || '7d';
    const limit = parseInt(req.query.limit) || 5;
    
    const focus = await analytics.getRecentActivityFocus(
      userId, 
      req.params.graphId, 
      period, 
      limit
    );
    
    res.json({
      success: true,
      data: focus,
      period: period
    });
  } catch (error) {
    console.error('Error in recent focus endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recent activity focus'
    });
  }
});

// Effort distribution
app.get('/api/analytics/effort-distribution/:graphId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    const period = req.query.period || '7d';
    
    const distribution = await analytics.getEffortDistribution(
      userId,
      req.params.graphId,
      period
    );
    
    res.json({
      success: true,
      data: distribution,
      period: period
    });
  } catch (error) {
    console.error('Error in effort distribution endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get effort distribution'
    });
  }
});

// Approaching completion
app.get('/api/analytics/near-completion/:graphId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    const threshold = parseFloat(req.query.threshold) || 0.7;
    
    const nearComplete = await analytics.getNodesApproachingCompletion(
      userId,
      req.params.graphId,
      threshold
    );
    
    res.json({
      success: true,
      data: nearComplete,
      threshold: threshold
    });
  } catch (error) {
    console.error('Error in near completion endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get nodes near completion'
    });
  }
});
```

## Phase 2: Frontend Components (Day 2-3)

### 2.1 Create new components structure

```
graphy/components/AdaptiveDashboard/
├── index.jsx (existing, to be enhanced)
├── AdaptiveDashboard.css (existing, to be enhanced)
├── components/
│   ├── CategoryCards.jsx
│   ├── RecentActivityFocus.jsx
│   ├── EffortDistribution.jsx
│   ├── ApproachingCompletion.jsx
│   └── PeriodSelector.jsx
```

### 2.2 Implementation examples

#### CategoryCards.jsx
```jsx
import React from 'react';
import { observer } from 'mobx-react-lite';

const CategoryCards = observer(({ categories = [], onCardClick }) => {
  const getTrendIcon = (direction) => {
    if (direction === 'up') return '↑';
    if (direction === 'down') return '↓';
    return '→';
  };
  
  const getTrendClass = (direction) => {
    if (direction === 'up') return 'trend-up';
    if (direction === 'down') return 'trend-down';
    return 'trend-stable';
  };
  
  return (
    <div className="category-cards-container">
      <div className="category-cards-grid">
        {categories.map(category => (
          <div 
            key={category.id}
            className="category-progress-card"
            onClick={() => onCardClick?.(category.id)}
          >
            <div className="category-card-header">
              <span className="category-emoji">{category.emoji}</span>
              <span className="category-name">{category.name}</span>
            </div>
            
            <div className="category-progress-section">
              <div className="progress-value">{category.progress}%</div>
              <div className={`progress-trend ${getTrendClass(category.trendDirection)}`}>
                <span className="trend-icon">{getTrendIcon(category.trendDirection)}</span>
                <span className="trend-value">{category.trend.toFixed(0)}%</span>
                <span className="trend-period">{category.periodLabel}</span>
              </div>
            </div>
            
            <div className="category-stats">
              <div className="stat-item">
                <span className="stat-label">Tasks</span>
                <span className="stat-value">{category.completions}/{category.totalTasks}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Time</span>
                <span className="stat-value">{formatDuration(category.totalTime)}</span>
              </div>
            </div>
            
            <div className="category-progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${category.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// Helper function
function formatDuration(ms) {
  if (!ms || ms === 0) return '0m';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default CategoryCards;
```

## Phase 3: Styling (Day 3)

### 3.1 Enhanced AdaptiveDashboard.css additions

```css
/* Category Progress Cards */
.category-cards-container {
  margin-bottom: 2rem;
}

.category-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}

.category-progress-card {
  background: linear-gradient(135deg, #1a1a1a 0%, #252525 100%);
  border: 1px solid rgba(20, 255, 225, 0.2);
  border-radius: 12px;
  padding: 1.25rem;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.category-progress-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--jade-color);
  transform: scaleX(0);
  transition: transform 0.3s ease;
}

.category-progress-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(20, 255, 225, 0.15);
  border-color: rgba(20, 255, 225, 0.4);
}

.category-progress-card:hover::before {
  transform: scaleX(1);
}

.category-card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.category-emoji {
  font-size: 1.5rem;
}

.category-name {
  font-size: 0.9rem;
  font-weight: 500;
  color: #e0e0e0;
}

.category-progress-section {
  margin-bottom: 1rem;
}

.progress-value {
  font-size: 2rem;
  font-weight: bold;
  color: var(--jade-color);
  margin-bottom: 0.25rem;
}

.progress-trend {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
}

.progress-trend.trend-up {
  color: var(--jade-color);
}

.progress-trend.trend-down {
  color: #ff6b6b;
}

.progress-trend.trend-stable {
  color: #999;
}

.trend-icon {
  font-weight: bold;
}

.category-stats {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.stat-item {
  display: flex;
  flex-direction: column;
}

.stat-item .stat-label {
  font-size: 0.75rem;
  color: #666;
  margin-bottom: 0.125rem;
}

.stat-item .stat-value {
  font-size: 0.875rem;
  color: #ccc;
  font-weight: 500;
}

.category-progress-bar {
  height: 4px;
  background: #2a2a2a;
  border-radius: 2px;
  overflow: hidden;
  margin-top: 0.75rem;
}

.category-progress-bar .progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--jade-color), rgba(20, 255, 225, 0.6));
  transition: width 0.5s ease;
  border-radius: 2px;
}

/* Recent Activity Focus */
.recent-focus-container {
  background: #1a1a1a;
  border-radius: 12px;
  padding: 1.5rem;
  border: 1px solid #2a2a2a;
}

.recent-focus-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
}

.recent-focus-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #e0e0e0;
}

.recent-focus-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.focus-item {
  display: flex;
  align-items: center;
  padding: 1rem;
  background: #252525;
  border-radius: 8px;
  transition: all 0.2s ease;
  cursor: pointer;
  border: 1px solid transparent;
}

.focus-item:hover {
  background: #2a2a2a;
  border-color: rgba(20, 255, 225, 0.3);
}

.focus-item-emoji {
  font-size: 1.25rem;
  margin-right: 1rem;
}

.focus-item-content {
  flex: 1;
}

.focus-item-title {
  font-weight: 500;
  color: #e0e0e0;
  margin-bottom: 0.25rem;
}

.focus-item-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.875rem;
  color: #999;
}

.focus-item-status {
  padding: 0.125rem 0.5rem;
  background: rgba(20, 255, 225, 0.1);
  color: var(--jade-color);
  border-radius: 4px;
  font-size: 0.75rem;
  margin-left: auto;
}

/* Effort Distribution */
.effort-container {
  background: #1a1a1a;
  border-radius: 12px;
  padding: 1.5rem;
  border: 1px solid #2a2a2a;
}

.effort-chart-wrapper {
  position: relative;
  height: 250px;
  margin-bottom: 1rem;
}

.effort-center-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}

.effort-percentage {
  font-size: 2.5rem;
  font-weight: bold;
  color: var(--jade-color);
  display: block;
}

.effort-label {
  font-size: 0.875rem;
  color: #999;
}

/* Approaching Completion */
.approaching-container {
  background: #1a1a1a;
  border-radius: 12px;
  padding: 1.5rem;
  border: 1px solid #2a2a2a;
}

.approaching-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.approaching-card {
  background: #252525;
  border-radius: 8px;
  padding: 1rem;
  position: relative;
  border: 1px solid transparent;
  transition: all 0.2s ease;
  cursor: pointer;
}

.approaching-card:hover {
  border-color: rgba(20, 255, 225, 0.3);
  transform: translateY(-1px);
}

.approaching-progress {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.circular-progress {
  --size: 50px;
  width: var(--size);
  height: var(--size);
  border-radius: 50%;
  background: conic-gradient(
    var(--jade-color) calc(var(--progress) * 3.6deg),
    #2a2a2a calc(var(--progress) * 3.6deg)
  );
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.circular-progress::before {
  content: '';
  position: absolute;
  width: calc(var(--size) - 10px);
  height: calc(var(--size) - 10px);
  border-radius: 50%;
  background: #252525;
}

.circular-progress-value {
  position: relative;
  z-index: 1;
  font-size: 0.875rem;
  font-weight: bold;
  color: var(--jade-color);
}

.approaching-info {
  flex: 1;
}

.approaching-title {
  font-weight: 500;
  color: #e0e0e0;
  margin-bottom: 0.25rem;
  font-size: 0.9rem;
}

.approaching-meta {
  font-size: 0.75rem;
  color: #999;
}

/* Period Selector */
.period-selector {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  padding: 0.25rem;
  background: #1a1a1a;
  border-radius: 8px;
  width: fit-content;
}

.period-button {
  padding: 0.5rem 1rem;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #999;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.875rem;
  font-weight: 500;
}

.period-button:hover {
  color: #ccc;
  background: #252525;
}

.period-button.active {
  background: var(--jade-color);
  color: black;
}

/* Main Analytics Grid */
.main-analytics-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 1.5rem;
  margin: 2rem 0;
}

@media (max-width: 1024px) {
  .main-analytics-grid {
    grid-template-columns: 1fr;
  }
}

/* Animations */
@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.category-progress-card,
.focus-item,
.approaching-card {
  animation: slideInUp 0.3s ease-out backwards;
}

.category-progress-card:nth-child(1) { animation-delay: 0.05s; }
.category-progress-card:nth-child(2) { animation-delay: 0.1s; }
.category-progress-card:nth-child(3) { animation-delay: 0.15s; }
.category-progress-card:nth-child(4) { animation-delay: 0.2s; }

.focus-item:nth-child(1) { animation-delay: 0.05s; }
.focus-item:nth-child(2) { animation-delay: 0.1s; }
.focus-item:nth-child(3) { animation-delay: 0.15s; }
.focus-item:nth-child(4) { animation-delay: 0.2s; }
.focus-item:nth-child(5) { animation-delay: 0.25s; }
```

## Phase 4: Testing Plan (Day 4)

### 4.1 Backend Testing
1. Test new analytics methods with sample data
2. Verify trend calculations work correctly
3. Test period filtering and data aggregation
4. Validate API endpoints response formats

### 4.2 Frontend Testing
1. Component rendering with various data states
2. Period selector functionality
3. Click interactions and navigation
4. Responsive design on different screen sizes
5. Animation performance

### 4.3 Integration Testing
1. End-to-end data flow from backend to UI
2. Real-time updates via WebSocket
3. Performance with large datasets
4. Error handling and fallbacks

## Deployment Checklist

- [ ] Backend analytics methods implemented
- [ ] API endpoints added and tested
- [ ] Frontend components created
- [ ] Styles integrated with dark theme
- [ ] Integration with existing analyticsService
- [ ] Testing completed
- [ ] Documentation updated
- [ ] Performance optimized
- [ ] Error handling implemented
- [ ] Docker configuration updated

## Success Metrics

1. **Performance**: Dashboard loads within 2 seconds
2. **Accuracy**: Analytics data matches actual graph state
3. **User Experience**: Smooth interactions and animations
4. **Reliability**: Handles edge cases gracefully
5. **Maintainability**: Clean, documented code structure

## Risk Mitigation

1. **Data Volume**: Implement pagination and data limits
2. **Real-time Updates**: Use debouncing and throttling
3. **Browser Compatibility**: Test on major browsers
4. **Mobile Experience**: Ensure responsive design works
5. **Error States**: Provide meaningful error messages

This implementation leverages existing infrastructure while adding sophisticated analytics features that provide actionable insights for users.