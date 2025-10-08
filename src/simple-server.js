/**
 * Simple Optimistic UI Server - Figma/Miro Style
 * Минимум абстракций, максимум производительности
 */

import { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import http from 'http';
import redis from './redis.js'; // Import shared Redis client
import SimplifiedAnalytics from './analytics-v2.js';
import { CronJob } from 'cron';
import progressSnapshots from './progress-snapshots.js';

// Default user ID for testing (matches frontend)
const DEFAULT_USER_ID = '1';

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Track connected clients
const clients = new Map();
let clientIdCounter = 1;

// Initialize Analytics Service (simplified version)
const analytics = new SimplifiedAnalytics(redis);

// Initialize daily snapshot job at 00:00 every day
const snapshotJob = new CronJob(
  '0 0 * * *', // At midnight every day
  async () => {
    console.log('🕐 Running daily progress snapshot job...');
    try {
      const snapshots = await progressSnapshots.snapshotAllNodes(new Date(), DEFAULT_USER_ID, 'main');
      console.log(`✅ Daily snapshot completed: ${snapshots.length} nodes`);
    } catch (error) {
      console.error('❌ Daily snapshot failed:', error);
    }
  },
  null,
  true, // Start the job right away
  'Europe/Belgrade' // Timezone
);

// Also run snapshot on startup for testing
setTimeout(async () => {
  console.log('📸 Running initial progress snapshot...');
  try {
    const snapshots = await progressSnapshots.snapshotAllNodes(new Date(), DEFAULT_USER_ID, 'main');
    console.log(`✅ Initial snapshot completed: ${snapshots.length} nodes`);
  } catch (error) {
    console.error('❌ Initial snapshot failed:', error);
  }
}, 5000); // Wait 5 seconds after startup

console.log('✅ Progress Snapshots Service initialized');

/**
 * Check if progress should be reset (daily reset logic)
 */
function shouldResetProgress(graph) {
  const settings = graph.settings || {};
  if (!settings.resetProgressEnabled) return false;
  
  const lastReset = settings.lastProgressReset;
  const now = new Date();
  
  if (!lastReset) return true;
  
  const lastResetDate = new Date(lastReset);
  const frequency = settings.resetFrequency || 'daily';
  
  if (frequency === 'daily') {
    return now.toDateString() !== lastResetDate.toDateString();
  } else if (frequency === 'weekly') {
    const weeksDiff = Math.floor((now - lastResetDate) / (7 * 24 * 60 * 60 * 1000));
    return weeksDiff >= 1;
  } else if (frequency === 'monthly') {
    return now.getMonth() !== lastResetDate.getMonth() ||
           now.getFullYear() !== lastResetDate.getFullYear();
  }
  
  return false;
}

/**
 * Reset progress for all nodes
 */
function resetAllProgress(graph) {
  const resetNode = (node) => {
    if (node.nodeType === 'dao') {
      node.isDone = false;
      node.currentCompletions = 0;
    }
    if (node.children) {
      node.children.forEach(resetNode);
    }
  };
  
  graph.nodes.forEach(resetNode);
  
  // Update settings
  if (!graph.settings) graph.settings = {};
  graph.settings.lastProgressReset = new Date().toISOString();
  
  console.log('✅ Progress reset for all nodes');
}

/**
 * Redis Operations - Simple and Direct
 */
async function getGraph(graphId, userId = DEFAULT_USER_ID) {
  try {
    console.log(`📖 Getting graph: ${graphId} for user: ${userId} from Redis`);
    
    // Try user-specific key first
    let data = await redis.get(`user:${userId}:graph:${graphId}`);
    
    // Fallback to old key format for backward compatibility
    if (!data) {
      data = await redis.get(`graph:${graphId}`);
      if (data) {
        console.log(`📦 Found graph in old format, will migrate on save`);
      }
    }
    
    if (!data) {
      console.log(`📭 Graph ${graphId} not found for user ${userId}, returning empty graph`);
      // Return default empty graph
      return {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        version: 0,
        userId: userId
      };
    }
    
    const graph = JSON.parse(data);
    // Ensure userId is in the graph
    if (!graph.userId) {
      graph.userId = userId;
    }
    
    console.log(`✅ Graph ${graphId} loaded for user ${userId}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    return graph;
  } catch (error) {
    console.error('❌ Redis get error:', error);
    return null;
  }
}

async function saveGraph(graphId, graph, userId = DEFAULT_USER_ID) {
  try {
    // Increment version
    graph.version = (graph.version || 0) + 1;
    graph.lastUpdated = new Date().toISOString();
    graph.userId = userId; // Store userId in graph
    
    const graphData = JSON.stringify(graph);
    const redisKey = `user:${userId}:graph:${graphId}`;
    
    console.log(`💾 Saving graph ${graphId} for user ${userId}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, version ${graph.version}`);
    
    await redis.set(redisKey, graphData);
    console.log(`✅ Graph ${graphId} saved to Redis for user ${userId} successfully`);
    
    // Clean up old key format if it exists
    const oldKey = `graph:${graphId}`;
    const oldData = await redis.get(oldKey);
    if (oldData) {
      await redis.del(oldKey);
      console.log(`🧹 Cleaned up old key format: ${oldKey}`);
    }
    
    // Also save to history (optional, for undo/redo)
    const historyKey = `history:${userId}:${graphId}:${Date.now()}`;
    await redis.setex(historyKey, 3600, graphData); // Keep for 1 hour
    
    return true;
  } catch (error) {
    console.error('❌ Redis save error:', error);
    return false;
  }
}

async function addOperation(graphId, operation) {
  try {
    const key = `operations:${graphId}`;
    await redis.lpush(key, JSON.stringify(operation));
    await redis.ltrim(key, 0, 99); // Keep last 100 operations
    return true;
  } catch (error) {
    console.error('Redis operation error:', error);
    return false;
  }
}

/**
 * Apply operation to graph
 */
async function applyOperation(graphId, operation, userId = DEFAULT_USER_ID) {
  const graph = await getGraph(graphId, userId);
  if (!graph) return null;

  const { type, payload } = operation;

  switch (type) {
    case 'ADD_NODE':
      // For new nodes, we need to add them to the correct parent
      const newNode = {
        id: payload.id,
        title: payload.title || 'New Node',
        nodeType: payload.nodeType || 'dao',
        nodeSubtype: payload.nodeSubtype || 'simple',
        position: payload.position || { x: 0, y: 0 },
        isDone: payload.isDone || false,
        currentCompletions: payload.currentCompletions || 0,
        requiredCompletions: payload.requiredCompletions || 1,
        calculatedProgress: payload.calculatedProgress || 0,
        linkedNodeIds: payload.linkedNodeIds || {},
        children: payload.children || []
      };
      
      // DIAGNOSTIC: Log linkedNodeIds status
      const linkedIdsCount = Object.keys(newNode.linkedNodeIds).length;
      console.log(`  📋 Adding node: id=${newNode.id}, title="${newNode.title}", isDone=${newNode.isDone}, completions=${newNode.currentCompletions}/${newNode.requiredCompletions}`);
      if (linkedIdsCount > 0) {
        console.log(`  🔗 Node has ${linkedIdsCount} linkedNodeIds connection types:`, Object.keys(newNode.linkedNodeIds));
        Object.entries(newNode.linkedNodeIds).forEach(([type, ids]) => {
          console.log(`     ${type}: [${ids.join(', ')}]`);
        });
      }
      
      let parentNode = null;
      
      // If there's a parentId, find parent and add as child
      if (payload.parentId) {
        console.log(`  Looking for parent ${payload.parentId} to add child ${payload.id}`);
        const findAndAddToParent = (nodes, depth = 0) => {
          for (let node of nodes) {
            console.log(`    ${'  '.repeat(depth)}Checking node ${node.id}`);
            if (node.id === payload.parentId) {
              if (!node.children) node.children = [];
              node.children.push(newNode);
              console.log(`    ✅ Found parent and added child at depth ${depth}`);
              parentNode = node; // Save reference to parent
              
              // Update parent's subtype if needed
              if (node.nodeType === 'dao' && node.nodeSubtype === 'simple') {
                node.nodeSubtype = 'withChildren';
                console.log(`    📝 Updated parent subtype to 'withChildren'`);
              } else if (node.nodeType === 'fundamental' && node.nodeSubtype === 'simple') {
                node.nodeSubtype = 'category';
                console.log(`    📝 Updated parent subtype to 'category'`);
              }
              
              return true;
            }
            if (node.children && node.children.length > 0) {
              if (findAndAddToParent(node.children, depth + 1)) return true;
            }
          }
          return false;
        };
        
        const found = findAndAddToParent(graph.nodes);
        if (!found) {
          // If parent not found, add as root (but warn)
          console.warn(`  ⚠️ Parent ${payload.parentId} not found! Adding as root node`);
          graph.nodes.push(newNode);
        }
      } else {
        // No parent, add as root node
        console.log(`  Adding ${payload.id} as root node (no parentId)`);
        graph.nodes.push(newNode);
      }
      
      // Log the resulting structure
      console.log(`  📊 After ADD_NODE - Graph has ${graph.nodes.length} root nodes`);
      let totalCount = 0;
      const countAll = (nodes, depth = 0) => {
        nodes.forEach(node => {
          totalCount++;
          if (node.children && node.children.length > 0) {
            countAll(node.children, depth + 1);
          }
        });
      };
      countAll(graph.nodes);
      console.log(`  📊 Total nodes in hierarchy: ${totalCount}`);
      
      // No need to track node creation - only progress updates matter
      
      break;

    case 'UPDATE_NODE':
      // Handle both payload.id and payload.nodeId for backward compatibility
      const nodeIdToUpdate = payload.id || payload.nodeId;
      console.log(`  📝 UPDATE_NODE for ${nodeIdToUpdate}:`, payload.updates);
      
      if (!nodeIdToUpdate) {
        console.error('  ❌ UPDATE_NODE: No node ID provided (checked both payload.id and payload.nodeId)');
        break;
      }
      
      // Recursively find and update node in hierarchy
      const updateNodeRecursive = (nodes) => {
        for (let node of nodes) {
          if (node.id === nodeIdToUpdate) {
            console.log(`  Found node ${nodeIdToUpdate}, current state: isDone=${node.isDone}, completions=${node.currentCompletions}/${node.requiredCompletions}`);
            
            // Update node properties
            Object.assign(node, payload.updates);
            
            // Special handling for children array
            if (payload.updates.children !== undefined) {
              node.children = payload.updates.children;
              console.log(`    Updated children array, now has ${node.children.length} children`);
              
              // DIAGNOSTIC: Check if children have linkedNodeIds
              const childrenWithLinks = node.children.filter(c => c.linkedNodeIds && Object.keys(c.linkedNodeIds).length > 0);
              if (childrenWithLinks.length > 0) {
                console.log(`    🔗 ${childrenWithLinks.length} children have linkedNodeIds`);
              }
            }
            
            // DIAGNOSTIC: Log linkedNodeIds updates
            if (payload.updates.linkedNodeIds !== undefined) {
              node.linkedNodeIds = payload.updates.linkedNodeIds;
              const linkedIdsCount = Object.keys(node.linkedNodeIds).length;
              console.log(`    🔗 Updated linkedNodeIds: ${linkedIdsCount} connection types`);
              if (linkedIdsCount > 0) {
                Object.entries(node.linkedNodeIds).forEach(([type, ids]) => {
                  console.log(`       ${type}: [${ids.join(', ')}]`);
                });
              }
            }
            
            // Ensure progress fields are preserved/updated
            if (payload.updates.isDone !== undefined) {
              node.isDone = payload.updates.isDone;
              console.log(`    Updated isDone to: ${node.isDone}`);
            }
            if (payload.updates.currentCompletions !== undefined) {
              node.currentCompletions = payload.updates.currentCompletions;
              console.log(`    Updated currentCompletions to: ${node.currentCompletions}`);
            }
            if (payload.updates.requiredCompletions !== undefined) {
              node.requiredCompletions = payload.updates.requiredCompletions;
              console.log(`    Updated requiredCompletions to: ${node.requiredCompletions}`);
            }
            if (payload.updates.nodeSubtype !== undefined) {
              node.nodeSubtype = payload.updates.nodeSubtype;
              console.log(`    Updated nodeSubtype to: ${node.nodeSubtype}`);
            }
            if (payload.updates.calculatedProgress !== undefined) {
              node.calculatedProgress = payload.updates.calculatedProgress;
              console.log(`    Updated calculatedProgress to: ${node.calculatedProgress}`);
            }
            
            console.log(`  After update: isDone=${node.isDone}, completions=${node.currentCompletions}/${node.requiredCompletions}, progress=${node.calculatedProgress ? Math.round(node.calculatedProgress * 100) : 0}%`);
            
            // Track analytics for progress updates ONLY
            if (payload.updates.isDone !== undefined || payload.updates.currentCompletions !== undefined) {
              // Track all affected nodes (current + parents that calculate from it)
              const affectedNodes = findAffectedNodes(graph.nodes, nodeIdToUpdate);
              
              for (const affectedNode of affectedNodes) {
                const category = findNodeCategory(graph.nodes, affectedNode.id);
                const nodePath = getNodePath(graph.nodes, affectedNode.id);
                
                // Calculate progress for each affected node
                const currentProgress = calculateNodeProgress(affectedNode);
                
                // Save calculatedProgress for affected nodes (especially important for fundamental nodes)
                if (affectedNode.nodeType === 'fundamental') {
                  affectedNode.calculatedProgress = currentProgress / 100; // Store as 0-1 value
                  console.log(`    Saved calculatedProgress=${affectedNode.calculatedProgress} for fundamental node ${affectedNode.id}`);
                }
                
                // Track progress update in simplified analytics
                analytics.trackProgressUpdate(DEFAULT_USER_ID, graphId, affectedNode.id, {
                  nodeTitle: affectedNode.title || affectedNode.name || 'Unknown',
                  nodePath: nodePath,
                  nodeType: affectedNode.nodeType,
                  nodeSubtype: affectedNode.nodeSubtype,
                  categoryId: category ? category.id : null,
                  categoryName: category ? (category.title || category.name) : null,
                  previousProgress: affectedNode.previousProgress || 0,
                  currentProgress: currentProgress,
                  isDone: affectedNode.isDone,
                  previousIsDone: affectedNode.previousIsDone,
                  currentCompletions: affectedNode.currentCompletions || 0,
                  requiredCompletions: affectedNode.requiredCompletions || 1
                });
                
                console.log(`  📊 Analytics: Tracked progress ${currentProgress}% for affected node ${affectedNode.id}`);
              }
            }
            
            return true;
          }
          if (node.children && node.children.length > 0) {
            if (updateNodeRecursive(node.children)) return true;
          }
        }
        return false;
      };
      const updated = updateNodeRecursive(graph.nodes);
      if (updated) {
        console.log(`  ✅ Node ${nodeIdToUpdate} updated successfully`);
      } else {
        console.log(`  ⚠️ Node ${nodeIdToUpdate} not found for update`);
      }
      break;

    case 'UPDATE_NODE_POSITION':
      // Recursively find and update node position in hierarchy
      const updatePositionRecursive = (nodes) => {
        for (let node of nodes) {
          if (node.id === payload.nodeId) {
            node.position = payload.position;
            return true;
          }
          if (node.children && node.children.length > 0) {
            if (updatePositionRecursive(node.children)) return true;
          }
        }
        return false;
      };
      updatePositionRecursive(graph.nodes);
      break;

    case 'DELETE_NODE':
      // Recursively remove node from hierarchy
      const removeNodeRecursive = (nodes) => {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === payload.nodeId) {
            nodes.splice(i, 1);
            return true;
          }
          if (nodes[i].children && nodes[i].children.length > 0) {
            if (removeNodeRecursive(nodes[i].children)) return true;
          }
        }
        return false;
      };
      
      removeNodeRecursive(graph.nodes);
      
      // Also remove edges connected to this node
      graph.edges = graph.edges.filter(e =>
        e.source !== payload.nodeId && e.target !== payload.nodeId
      );
      break;

    case 'ADD_EDGE':
      graph.edges.push({
        id: payload.id,
        source: payload.source,
        target: payload.target,
        type: payload.type || 'floating'
      });
      break;

    case 'DELETE_EDGE':
      graph.edges = graph.edges.filter(e => e.id !== payload.edgeId);
      break;

    case 'UPDATE_VIEWPORT':
      graph.viewport = payload;
      break;

    default:
      console.warn('Unknown operation type:', type);
      return null;
  }

  await saveGraph(graphId, graph, userId);
  await addOperation(graphId, operation);
  
  return graph;
}

/**
 * Helper: Find category parent for a node
 */
function findNodeCategory(nodes, targetNodeId, parent = null) {
  for (const node of nodes) {
    if (node.id === targetNodeId) {
      // Found target, return parent if it's a category
      if (parent && parent.nodeType === 'fundamental' && parent.nodeSubtype === 'category') {
        return parent;
      }
      return null;
    }
    if (node.children) {
      const found = findNodeCategory(node.children, targetNodeId, node);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Helper: Get node path from root to node
 */
function getNodePath(nodes, targetNodeId, currentPath = []) {
  for (const node of nodes) {
    const newPath = [...currentPath, node.id];
    if (node.id === targetNodeId) {
      return newPath;
    }
    if (node.children) {
      const found = getNodePath(node.children, targetNodeId, newPath);
      if (found) return found;
    }
  }
  return [];
}

/**
 * Calculate node progress (handles both DAO and Fundamental nodes)
 */
function calculateNodeProgress(node) {
  if (node.nodeType === 'dao') {
    if (node.isDone) return 100;
    if (node.requiredCompletions > 0) {
      return (node.currentCompletions / node.requiredCompletions) * 100;
    }
    return 0;
  } else if (node.nodeType === 'fundamental') {
    // For fundamental nodes, calculate from children
    if (node.nodeSubtype === 'category' && node.children) {
      const childProgress = node.children.map(child => calculateNodeProgress(child));
      if (childProgress.length > 0) {
        return childProgress.reduce((a, b) => a + b, 0) / childProgress.length;
      }
    }
    // Use calculatedProgress if available
    return (node.calculatedProgress || 0) * 100;
  }
  return 0;
}

/**
 * Find all nodes affected by a change (current + parents)
 */
function findAffectedNodes(nodes, targetNodeId, affected = []) {
  // First, find the target node
  let targetNode = null;
  const findTarget = (nodes) => {
    for (const node of nodes) {
      if (node.id === targetNodeId) {
        targetNode = node;
        return;
      }
      if (node.children) findTarget(node.children);
    }
  };
  findTarget(nodes);
  
  if (targetNode) {
    affected.push(targetNode);
  }
  
  // Find all parents that might be affected
  const findParents = (nodes, parent = null) => {
    for (const node of nodes) {
      if (node.children) {
        // Check if this node has the target as a child
        if (node.children.some(child => child.id === targetNodeId)) {
          if (!affected.find(n => n.id === node.id)) {
            affected.push(node);
            // Recursively find parents of this parent
            findAffectedNodes(nodes, node.id, affected);
          }
        }
        // Continue searching in children
        findParents(node.children, node);
      }
    }
  };
  findParents(nodes);
  
  return affected;
}

/**
 * WebSocket Connection Handler
 */
wss.on('connection', (ws, req) => {
  const clientId = clientIdCounter++;
  const clientInfo = {
    id: clientId,
    ws: ws,
    graphId: null,
    userId: null
  };
  
  clients.set(clientId, clientInfo);
  console.log(`👤 Client ${clientId} connected`);

  // Send connection confirmation
  ws.send(JSON.stringify({
    type: 'CONNECTION_ESTABLISHED',
    clientId: clientId
  }));

  // Handle messages
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`📨 Message from client ${clientId}:`, data.type, data.payload?.type || '');
      
      switch (data.type) {
        case 'SUBSCRIBE':
          // Subscribe to a specific graph
          clientInfo.graphId = data.graphId;
          clientInfo.userId = data.userId || DEFAULT_USER_ID;
          
          // DIAGNOSTIC: Log userId status
          if (!data.userId) {
            console.error(`⚠️  Client ${clientId} SUBSCRIBE without userId! Using DEFAULT_USER_ID='${DEFAULT_USER_ID}'`);
            console.error(`   This will cause user isolation failure - all users share same graph!`);
          } else {
            console.log(`✅ Client ${clientId} subscribed to graph "${data.graphId}" with userId="${clientInfo.userId}"`);
          }
          
          // Send current graph state
          const graph = await getGraph(data.graphId, clientInfo.userId);
          
          // Ensure settings are included
          if (!graph.settings) {
            graph.settings = {};
          }
          
          // Check if we need to reset progress
          if (shouldResetProgress(graph)) {
            console.log('🔄 Daily reset triggered, resetting progress...');
            resetAllProgress(graph);
            await saveGraph(data.graphId, graph, clientInfo.userId);
          }
          
          // Debug: Check graph structure before sending
          console.log('📊 Graph structure check before sending:');
          console.log(`  Root nodes: ${graph.nodes.length}`);
          let totalNodes = 0;
          const countNodes = (nodes) => {
            nodes.forEach(node => {
              totalNodes++;
              if (node.children && node.children.length > 0) {
                console.log(`    Node "${node.title}" has ${node.children.length} children`);
                countNodes(node.children);
              }
            });
          };
          countNodes(graph.nodes);
          console.log(`  Total nodes in hierarchy: ${totalNodes}`);
          
          const stateMessage = JSON.stringify({
            type: 'GRAPH_STATE',
            payload: graph
          });
          ws.send(stateMessage);
          console.log(`📤 Sent initial graph state to client ${clientId}`);
          break;

        case 'OPERATION':
          // Apply operation and broadcast to all subscribed clients
          if (!clientInfo.graphId) {
            console.warn(`⚠️ Client ${clientId} tried to send operation without subscription`);
            ws.send(JSON.stringify({
              type: 'ERROR',
              message: 'Not subscribed to any graph'
            }));
            return;
          }

          console.log(`🔧 Applying operation: ${data.payload.type} to graph ${clientInfo.graphId} for user ${clientInfo.userId}`);
          const result = await applyOperation(clientInfo.graphId, data.payload, clientInfo.userId);
          if (result) {
            // Broadcast to all clients subscribed to this graph
            const broadcastMessage = JSON.stringify({
              type: 'OPERATION_APPLIED',
              payload: data.payload,
              userId: clientInfo.userId,
              clientId: clientId, // Add sender's ID
              timestamp: Date.now()
            });

            let broadcastCount = 0;
            clients.forEach((client, id) => {
              if (client.graphId === clientInfo.graphId &&
                  client.ws.readyState === 1) { // 1 = OPEN state
                client.ws.send(broadcastMessage);
                broadcastCount++;
                console.log(`  → Sent to client ${id} (${id === clientId ? 'sender' : 'other tab'})`);
              }
            });
            
            console.log(`📢 Operation ${data.payload.type} broadcasted to ${broadcastCount} clients`);
          } else {
            console.error(`❌ Failed to apply operation ${data.payload.type}`);
          }
          break;

        case 'SYNC':
          // Full sync request
          if (clientInfo.graphId) {
            const syncGraph = await getGraph(clientInfo.graphId, clientInfo.userId);
            ws.send(JSON.stringify({
              type: 'SYNC_RESPONSE',
              payload: syncGraph
            }));
          }
          break;

        case 'PING':
          // Heartbeat from client
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;

        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Message handling error:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: error.message
      }));
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`👋 Client ${clientId} disconnected`);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`Client ${clientId} error:`, error);
  });
});

/**
 * REST API Endpoints (for compatibility with existing frontend)
 */

// Get graph
app.get('/api/graphs/:graphId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    const graph = await getGraph(req.params.graphId, userId);
    
    // Ensure settings are included in the response
    if (graph && !graph.settings) {
      graph.settings = {};
    }
    
    res.json({
      success: true,
      graph: graph
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Save graph
app.post('/api/graphs/:graphId', async (req, res) => {
  try {
    const graphId = req.params.graphId;
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    console.log(`📝 REST API: Saving graph ${graphId} for user ${userId}`);
    console.log(`   Nodes: ${req.body.nodes?.length || 0}, Edges: ${req.body.edges?.length || 0}`);
    
    const graph = await getGraph(graphId, userId);
    
    // Merge with existing data
    const updatedGraph = {
      ...graph,
      nodes: req.body.nodes || graph.nodes,
      edges: req.body.edges || graph.edges,
      viewport: req.body.viewport || graph.viewport,
      settings: req.body.settings || graph.settings || {} // Include settings from request
    };
    
    const saved = await saveGraph(graphId, updatedGraph, userId);
    
    if (saved) {
      console.log(`✅ REST API: Graph ${graphId} saved successfully`);
      
      // Broadcast the update to all WebSocket clients
      const broadcastMessage = JSON.stringify({
        type: 'GRAPH_UPDATED',
        payload: updatedGraph,
        source: 'rest_api',
        timestamp: Date.now()
      });
      
      let broadcastCount = 0;
      clients.forEach((client) => {
        if (client.graphId === graphId &&
            client.ws.readyState === 1) { // 1 = OPEN state
          client.ws.send(broadcastMessage);
          broadcastCount++;
        }
      });
      
      if (broadcastCount > 0) {
        console.log(`📢 REST update broadcasted to ${broadcastCount} WebSocket clients`);
      }
      
      res.json({
        success: true,
        version: updatedGraph.version
      });
    } else {
      throw new Error('Failed to save graph');
    }
  } catch (error) {
    console.error(`❌ REST API save error:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get user info
app.get('/api/users/:userId', async (req, res) => {
  try {
    // Simple user response for compatibility
    res.json({
      userId: req.params.userId,
      email: `user${req.params.userId}@example.com`,
      created: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create user
app.post('/api/users', async (req, res) => {
  try {
    const userId = req.body.userId || Date.now().toString();
    res.json({
      userId: userId,
      email: req.body.email || `user${userId}@example.com`,
      created: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// List user graphs
app.get('/api/users/:userId/graphs', async (req, res) => {
  try {
    // For simplicity, return predefined graphs
    // In production, this would query user's graphs from Redis
    res.json({
      success: true,
      graphs: ['main', 'project1', 'ideas']
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Progress comparison endpoint - MUST BE BEFORE :graphId route
app.get('/api/analytics/progress-comparison', async (req, res) => {
  try {
    if (!progressSnapshots) {
      throw new Error('Progress Snapshots Service not initialized');
    }
    
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    const { period = '30d', nodeIds } = req.query;
    
    // Parse nodeIds from query string
    const ids = nodeIds ? (Array.isArray(nodeIds) ? nodeIds : nodeIds.split(',')) : [];
    
    if (ids.length === 0) {
      return res.json({
        success: true,
        comparisons: []
      });
    }
    
    console.log(`📊 Getting progress comparison for ${ids.length} nodes, period: ${period}`);
    
    // Convert period to days
    const periodDays = period === 'today' ? 1 :
                      period === '7d' ? 7 :
                      period === '30d' ? 30 : 30;
    
    // Extract graphId from request (default to 'main')
    const graphId = req.query.graphId || 'main';
    
    const comparisons = await progressSnapshots.batchCompareProgress(ids, periodDays, userId, graphId);
    
    res.json({
      success: true,
      period,
      comparisons
    });
  } catch (error) {
    console.error('❌ Progress comparison error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual snapshot endpoint (for testing)
app.post('/api/analytics/snapshot', async (req, res) => {
  try {
    if (!progressSnapshots) {
      throw new Error('Progress Snapshots Service not initialized');
    }
    
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    const graphId = req.query.graphId || 'main';
    console.log(`📸 Manual snapshot triggered for user ${userId}, graph ${graphId}`);
    
    const snapshots = await progressSnapshots.snapshotAllNodes(new Date(), userId, graphId);
    
    res.json({
      success: true,
      message: `Created ${snapshots.length} snapshots`,
      snapshots: snapshots.slice(0, 10) // Return first 10 as sample
    });
  } catch (error) {
    console.error('❌ Manual snapshot error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get available snapshots for a node
app.get('/api/analytics/snapshots/:nodeId', async (req, res) => {
  try {
    if (!progressSnapshots) {
      throw new Error('Progress Snapshots Service not initialized');
    }
    
    const { nodeId } = req.params;
    const dates = await progressSnapshots.getAvailableDates(nodeId);
    
    res.json({
      success: true,
      nodeId,
      dates: dates.map(d => d.toISOString()),
      count: dates.length
    });
  } catch (error) {
    console.error('❌ Get snapshots error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Simplified Analytics endpoints - AFTER specific routes
app.get('/api/analytics/:graphId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    const graphId = req.params.graphId;
    const contextNodeId = req.query.context || null;
    const period = 'all'; // MVP - only all time
    
    console.log(`📊 Getting analytics for ${graphId}, context: ${contextNodeId || 'root'}`);
    const analytics_data = await analytics.getAnalytics(userId, graphId, {
      period,
      contextNodeId
    });
    
    res.json({
      success: true,
      data: analytics_data
    });
  } catch (error) {
    console.error('❌ Analytics error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Category analytics endpoint
app.get('/api/analytics/categories/:graphId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    const contextNodeId = req.query.context || null;
    
    console.log(`📊 Getting category analytics for graph ${req.params.graphId}`);
    const categories = await analytics.getCategoryAnalytics(userId, req.params.graphId, contextNodeId);
    
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('❌ Category analytics error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// AI Planning endpoint (dynamic import to avoid startup crash if API key missing)
app.post('/api/ai/generate-plan', async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'messages array is required'
      });
    }
    
    console.log('🤖 Generating AI plan for messages:', messages.length);
    
    // Dynamic import - only loads when endpoint is called
    const aiPlanningModule = await import('./ai-planning.js');
    const aiPlanning = aiPlanningModule.default;
    
    // Format and send to AI
    const formattedMessages = aiPlanning.formatMessagesForAPI(messages);
    const response = await aiPlanning.sendMessageToAI(formattedMessages);
    
    res.json({
      success: true,
      response
    });
  } catch (error) {
    console.error('❌ AI planning error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    redis: redis.status === 'ready',
    websocket: wss.clients.size,
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   Optimistic UI Server (Figma Style)  ║
╠═══════════════════════════════════════╣
║   WebSocket: ws://localhost:${PORT}      ║
║   REST API:  http://localhost:${PORT}    ║
║   Redis:     ${redis.options.host}:${redis.options.port}         ║
╚═══════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing connections...');
  
  // Close WebSocket connections
  wss.clients.forEach((client) => {
    client.close();
  });
  
  // Close Redis connection
  redis.disconnect();
  
  // Close HTTP server
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export { app, wss };