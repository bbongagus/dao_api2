/**
 * Simple Optimistic UI Server - Figma/Miro Style
 * Минимум абстракций, максимум производительности
 */

const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');
const http = require('http');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize Redis
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000)
});

// Initialize HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Track connected clients
const clients = new Map();
let clientIdCounter = 1;

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
async function getGraph(graphId) {
  try {
    console.log(`📖 Getting graph: ${graphId} from Redis`);
    const data = await redis.get(`graph:${graphId}`);
    if (!data) {
      console.log(`📭 Graph ${graphId} not found, returning empty graph`);
      // Return default empty graph
      return {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        version: 0
      };
    }
    const graph = JSON.parse(data);
    console.log(`✅ Graph ${graphId} loaded: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    return graph;
  } catch (error) {
    console.error('❌ Redis get error:', error);
    return null;
  }
}

async function saveGraph(graphId, graph) {
  try {
    // Increment version
    graph.version = (graph.version || 0) + 1;
    graph.lastUpdated = new Date().toISOString();
    
    const graphData = JSON.stringify(graph);
    console.log(`💾 Saving graph ${graphId}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, version ${graph.version}`);
    
    await redis.set(`graph:${graphId}`, graphData);
    console.log(`✅ Graph ${graphId} saved to Redis successfully`);
    
    // Also save to history (optional, for undo/redo)
    const historyKey = `history:${graphId}:${Date.now()}`;
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
async function applyOperation(graphId, operation) {
  const graph = await getGraph(graphId);
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
        linkedNodeIds: payload.linkedNodeIds || {},
        children: payload.children || []
      };
      console.log(`  📋 Adding node: id=${newNode.id}, title="${newNode.title}", isDone=${newNode.isDone}, completions=${newNode.currentCompletions}/${newNode.requiredCompletions}`);
      
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
            
            console.log(`  After update: isDone=${node.isDone}, completions=${node.currentCompletions}/${node.requiredCompletions}`);
            
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

  await saveGraph(graphId, graph);
  await addOperation(graphId, operation);
  
  return graph;
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
          clientInfo.userId = data.userId;
          console.log(`📡 Client ${clientId} subscribed to graph "${data.graphId}" as user ${data.userId}`);
          
          // Send current graph state
          const graph = await getGraph(data.graphId);
          
          // Check if we need to reset progress
          if (shouldResetProgress(graph)) {
            console.log('🔄 Daily reset triggered, resetting progress...');
            resetAllProgress(graph);
            await saveGraph(data.graphId, graph);
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

          console.log(`🔧 Applying operation: ${data.payload.type} to graph ${clientInfo.graphId}`);
          const result = await applyOperation(clientInfo.graphId, data.payload);
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
                  client.ws.readyState === WebSocket.OPEN) {
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
            const syncGraph = await getGraph(clientInfo.graphId);
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
    const graph = await getGraph(req.params.graphId);
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
    console.log(`📝 REST API: Saving graph ${graphId}`);
    console.log(`   Nodes: ${req.body.nodes?.length || 0}, Edges: ${req.body.edges?.length || 0}`);
    
    const graph = await getGraph(graphId);
    
    // Merge with existing data
    const updatedGraph = {
      ...graph,
      nodes: req.body.nodes || graph.nodes,
      edges: req.body.edges || graph.edges,
      viewport: req.body.viewport || graph.viewport
    };
    
    const saved = await saveGraph(graphId, updatedGraph);
    
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
            client.ws.readyState === WebSocket.OPEN) {
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

module.exports = { app, wss };