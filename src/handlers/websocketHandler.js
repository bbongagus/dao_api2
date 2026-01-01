/**
 * WebSocket Handler - Refactored with logger utility
 * Handles WebSocket connections and message processing
 */

import { logger } from '../utils/logger.js';
import { DEFAULT_USER_ID, shouldResetProgress, resetAllProgress } from '../services/graphService.js';

/**
 * Setup WebSocket handler
 * @param {Object} deps - Dependencies (wss, clients, getGraph, saveGraph, addOperation, applyOperation, analytics)
 */
export function setupWebSocketHandler(deps) {
  const { wss, clients, getGraph, saveGraph, addOperation, applyOperation } = deps;
  
  let clientIdCounter = 1;

  wss.on('connection', (ws, req) => {
    const clientId = clientIdCounter++;
    const clientInfo = {
      id: clientId,
      ws: ws,
      graphId: null,
      userId: null
    };
    
    clients.set(clientId, clientInfo);
    logger.ws('connected', clientId);

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'CONNECTION_ESTABLISHED',
      clientId: clientId
    }));

    // Handle messages
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        
        // Skip logging for high-frequency operations (position updates ~60 FPS)
        const isHighFrequency = data.type === 'OPERATION' &&
          data.payload?.type === 'UPDATE_NODE_POSITION';
        
        if (!isHighFrequency && data.type !== 'PING') {
          logger.ws(data.type, clientId, data.payload?.type || '');
        }
        
        switch (data.type) {
          case 'SUBSCRIBE':
            await handleSubscribe(data, clientInfo, clientId, ws, getGraph, saveGraph);
            break;

          case 'OPERATION':
            await handleOperation(data, clientInfo, clientId, ws, clients, applyOperation);
            break;

          case 'SYNC':
            await handleSync(clientInfo, ws, getGraph);
            break;

          case 'PING':
            ws.send(JSON.stringify({ type: 'PONG' }));
            break;

          default:
            logger.warn(`Unknown message type: ${data.type}`);
        }
      } catch (error) {
        logger.error('Message handling error:', error);
        ws.send(JSON.stringify({
          type: 'ERROR',
          message: error.message
        }));
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      clients.delete(clientId);
      logger.ws('disconnected', clientId);
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error(`Client ${clientId} error:`, error);
    });
  });
}

/**
 * Handle SUBSCRIBE message
 */
async function handleSubscribe(data, clientInfo, clientId, ws, getGraph, saveGraph) {
  clientInfo.graphId = data.graphId;
  clientInfo.userId = data.userId || DEFAULT_USER_ID;
  
  // Log userId status
  if (!data.userId) {
    logger.warn(`Client ${clientId} SUBSCRIBE without userId! Using DEFAULT_USER_ID`);
  } else {
    logger.success(`Client ${clientId} subscribed to "${data.graphId}" userId="${clientInfo.userId}"`);
  }
  
  // Get current graph state
  const graph = await getGraph(data.graphId, clientInfo.userId);
  
  // Ensure settings are included
  if (!graph.settings) {
    graph.settings = {};
  }
  
  // Check if we need to reset progress
  if (shouldResetProgress(graph)) {
    logger.info('Daily reset triggered, resetting progress...');
    resetAllProgress(graph);
    await saveGraph(data.graphId, graph, clientInfo.userId);
  }
  
  // Debug: Log graph structure
  logger.debug(`Graph structure: ${graph.nodes.length} root nodes, ${countTotalNodes(graph.nodes)} total`);
  
  // Send graph state
  ws.send(JSON.stringify({
    type: 'GRAPH_STATE',
    payload: graph
  }));
  
  logger.debug(`Sent initial graph state to client ${clientId}`);
}

/**
 * Handle OPERATION message
 */
async function handleOperation(data, clientInfo, clientId, ws, clients, applyOperation) {
  if (!clientInfo.graphId) {
    logger.warn(`Client ${clientId} tried to send operation without subscription`);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Not subscribed to any graph'
    }));
    return;
  }

  // Skip logging for high-frequency operations (position updates ~60 FPS)
  const isHighFrequency = data.payload.type === 'UPDATE_NODE_POSITION';
  
  if (!isHighFrequency) {
    logger.debug(`Applying ${data.payload.type} to graph ${clientInfo.graphId}`);
  }
  
  const result = await applyOperation(clientInfo.graphId, data.payload, clientInfo.userId);
  
  if (result) {
    // Broadcast to all clients subscribed to this graph
    const broadcastMessage = JSON.stringify({
      type: 'OPERATION_APPLIED',
      payload: data.payload,
      userId: clientInfo.userId,
      clientId: clientId,
      timestamp: Date.now()
    });

    let broadcastCount = 0;
    clients.forEach((client, id) => {
      if (client.graphId === clientInfo.graphId && client.ws.readyState === 1) {
        client.ws.send(broadcastMessage);
        broadcastCount++;
      }
    });
    
    // Only log non-position operations
    if (!isHighFrequency) {
      logger.debug(`Operation ${data.payload.type} broadcasted to ${broadcastCount} clients`);
    }
  } else {
    logger.error(`Failed to apply operation ${data.payload.type}`);
  }
}

/**
 * Handle SYNC message
 */
async function handleSync(clientInfo, ws, getGraph) {
  if (clientInfo.graphId) {
    const syncGraph = await getGraph(clientInfo.graphId, clientInfo.userId);
    ws.send(JSON.stringify({
      type: 'SYNC_RESPONSE',
      payload: syncGraph
    }));
    logger.debug(`Sent sync response for graph ${clientInfo.graphId}`);
  }
}

/**
 * Count total nodes in hierarchy
 */
function countTotalNodes(nodes) {
  let count = 0;
  const traverse = (nodeList) => {
    nodeList.forEach(node => {
      count++;
      if (node.children && node.children.length > 0) {
        traverse(node.children);
      }
    });
  };
  traverse(nodes);
  return count;
}

export default setupWebSocketHandler;
