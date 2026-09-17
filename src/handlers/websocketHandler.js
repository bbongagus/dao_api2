/**
 * WebSocket Handler - Refactored with logger utility
 * Handles WebSocket connections and message processing
 */

import { logger } from '../utils/logger.js';
import { shouldResetProgress, resetAllProgress } from '../services/graphService.js';
import { VerifierUnavailableError } from '../auth/verifyToken.js';
import { broadcastToGraph } from './broadcast.js';

/** Close code for a SUBSCRIBE whose token proves no user: the client stops retrying and signs in again. */
export const UNAUTHORIZED = 4401;

/** Close code for a SUBSCRIBE whose token cannot be checked right now: the client reconnects later, as after any drop. */
export const TRY_AGAIN_LATER = 1013;

/**
 * Setup WebSocket handler
 * @param {Object} deps - Dependencies (wss, clients, getGraph, saveGraph, applyOperation, verifyToken)
 */
export function setupWebSocketHandler(deps) {
  const { wss, clients, getGraph, saveGraph, applyOperation, verifyToken } = deps;
  
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
    const handleMessage = async (message) => {
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
            await handleSubscribe(data, clientInfo, clientId, ws, { getGraph, saveGraph, verifyToken });
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
    };

    // One message at a time: a SUBSCRIBE's token check is async, and an
    // OPERATION sent right behind it must wait for it, not be refused.
    let inbox = Promise.resolve();
    ws.on('message', (message) => {
      // handleMessage answers its own errors; this catch only keeps one that
      // escapes it from stopping every later message on the socket.
      inbox = inbox.then(() => handleMessage(message)).catch((error) => {
        logger.error(`Client ${clientId} message queue error:`, error);
      });
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
 *
 * The token is checked before anything is read. The socket's user is the one
 * the token proves, whatever else the message says; a userId field is ignored.
 */
async function handleSubscribe(data, clientInfo, clientId, ws, { getGraph, saveGraph, verifyToken }) {
  let userId;
  try {
    ({ userId } = await verifyToken(data.token));
  } catch (error) {
    // Whatever this socket was subscribed to before, it is not any more.
    clientInfo.userId = null;
    clientInfo.graphId = null;

    // Not a refusal: the client reconnects in a while instead of sending the
    // person to sign in for an outage that is not theirs.
    if (error instanceof VerifierUnavailableError) {
      logger.error(`Client ${clientId} SUBSCRIBE could not be checked: ${error.message}`);
      ws.send(JSON.stringify({ type: 'AUTH_UNAVAILABLE' }));
      ws.close(TRY_AGAIN_LATER, 'try again later');
      return;
    }

    logger.warn(`Client ${clientId} SUBSCRIBE refused: ${error.message}`);
    ws.send(JSON.stringify({ type: 'AUTH_ERROR' }));
    ws.close(UNAUTHORIZED, 'unauthorized');
    return;
  }

  clientInfo.userId = userId;
  clientInfo.graphId = data.graphId;
  logger.success(`Client ${clientId} subscribed to "${data.graphId}" userId="${userId}"`);

  // Get current graph state
  const graph = await getGraph(data.graphId, userId);
  
  // Ensure settings are included
  if (!graph.settings) {
    graph.settings = {};
  }
  
  // Check if we need to reset progress
  if (shouldResetProgress(graph)) {
    logger.info('Daily reset triggered, resetting progress...');
    resetAllProgress(graph);
    await saveGraph(data.graphId, graph, userId);
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
  if (!clientInfo.userId || !clientInfo.graphId) {
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
    const broadcastCount = broadcastToGraph(
      clients,
      { userId: clientInfo.userId, graphId: clientInfo.graphId },
      {
        type: 'OPERATION_APPLIED',
        payload: data.payload,
        userId: clientInfo.userId,
        clientId: clientId,
        timestamp: Date.now()
      }
    );
    
    // Only log non-position operations
    if (!isHighFrequency) {
      logger.debug(`Operation ${data.payload.type} broadcasted to ${broadcastCount} clients`);
    }
  } else {
    logger.error(`Failed to apply operation ${data.payload.type}`);
    ws.send(JSON.stringify({
      type: 'OPERATION_ERROR',
      payload: data.payload,
      error: `Operation ${data.payload.type} failed`,
      timestamp: Date.now()
    }));
  }
}

/**
 * Handle SYNC message
 */
async function handleSync(clientInfo, ws, getGraph) {
  if (clientInfo.userId && clientInfo.graphId) {
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
