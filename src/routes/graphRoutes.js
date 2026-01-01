/**
 * Graph Routes - Extracted from simple-server.js
 * REST API endpoints for graph operations
 * Copied from simple-server.js lines 762-843, 846-894
 */

import express from 'express';
import { DEFAULT_USER_ID } from '../services/graphService.js';

const router = express.Router();

/**
 * Setup graph routes with dependencies
 * @param {Object} deps - Dependencies (redis, getGraph, saveGraph, clients)
 */
export function setupGraphRoutes(deps) {
  const { getGraph, saveGraph, clients } = deps;

  // Get graph
  // Copied from simple-server.js lines 762-782
  router.get('/graphs/:graphId', async (req, res) => {
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
  // Copied from simple-server.js lines 785-843
  router.post('/graphs/:graphId', async (req, res) => {
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
  // Copied from simple-server.js lines 846-860
  router.get('/users/:userId', async (req, res) => {
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
  // Copied from simple-server.js lines 863-877
  router.post('/users', async (req, res) => {
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
  // Copied from simple-server.js lines 880-894
  router.get('/users/:userId/graphs', async (req, res) => {
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

  return router;
}

export default router;
