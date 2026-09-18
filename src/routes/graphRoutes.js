/**
 * Graph Routes - Extracted from simple-server.js
 * REST API endpoints for graph operations
 * Includes Daily Completions endpoints for eye-toggle feature
 *
 * Mounted behind requireUser (server.js): req.userId is the user the request's
 * token proves. Nothing here takes a user from a header, a parameter or the body.
 */

import express from 'express';
import dailyCompletions from '../services/dailyCompletions.js';
import { broadcastToGraph } from '../handlers/broadcast.js';
import { createGraphQueue } from '../handlers/graphQueue.js';
import { logger } from '../utils/logger.js';


/**
 * Setup graph routes with dependencies
 * @param {Object} deps - Dependencies (getGraph, saveGraph, clients)
 */
export function setupGraphRoutes(deps) {
  const { getGraph, saveGraph, clients } = deps;
  // server.js passes the same queue the WebSocket operations use. A queue of
  // its own would still stop two saves colliding, but not a save colliding
  // with an operation — which is the case that loses work.
  const graphQueue = deps.graphQueue ?? createGraphQueue();

  // Per call, not per module: a module-level router accumulates the handlers of
  // every setup and answers them all with the first one's dependencies.
  const router = express.Router();

  // Get graph
  // Copied from simple-server.js lines 762-782
  router.get('/graphs/:graphId', async (req, res) => {
    try {
      const graph = await getGraph(req.params.graphId, req.userId);

      // Ensure settings are included in the response
      if (graph && !graph.settings) {
        graph.settings = {};
      }

      res.json({
        success: true,
        graph: graph
      });
    } catch (error) {
      logger.error('REST API load error:', error);
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
      const userId = req.userId;
      console.log(`📝 REST API: Saving graph ${graphId} for user ${userId}`);
      console.log(`   Nodes: ${req.body.nodes?.length || 0}, Edges: ${req.body.edges?.length || 0}`);

      // Read-modify-write, so it belongs in the graph's queue like every other
      // one. Outside it, this read could see a graph mid-operation and the
      // write then replace whatever that operation saved: the body is a whole
      // graph, not a patch, so the loss is silent and total.
      const { updatedGraph, saved } = await graphQueue.enqueue(`${userId}:${graphId}`, async () => {
        const graph = await getGraph(graphId, userId);

        // Merge with existing data
        const merged = {
          ...graph,
          nodes: req.body.nodes || graph.nodes,
          edges: req.body.edges || graph.edges,
          viewport: req.body.viewport || graph.viewport,
          settings: req.body.settings || graph.settings || {} // Include settings from request
        };

        return { updatedGraph: merged, saved: await saveGraph(graphId, merged, userId) };
      });

      if (saved) {
        console.log(`✅ REST API: Graph ${graphId} saved successfully`);

        const broadcastCount = broadcastToGraph(clients, { userId, graphId }, {
          type: 'GRAPH_UPDATED',
          payload: updatedGraph,
          source: 'rest_api',
          timestamp: Date.now()
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
      logger.error('REST API save error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ============================================
  // Daily Completions endpoints (eye-toggle feature)
  // ============================================

  /**
   * GET /api/graphs/:graphId/daily-completions
   * Returns list of node IDs completed today
   */
  router.get('/graphs/:graphId/daily-completions', async (req, res) => {
    try {
      const { graphId } = req.params;

      const completions = await dailyCompletions.getCompletionIds(req.userId, graphId);
      const today = new Date().toISOString().split('T')[0];

      res.json({
        success: true,
        date: today,
        completions: completions,
        count: completions.length
      });
    } catch (error) {
      logger.error('Failed to get daily completions:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/graphs/:graphId/daily-completions/details
   * Returns detailed completions with timestamps
   */
  router.get('/graphs/:graphId/daily-completions/details', async (req, res) => {
    try {
      const { graphId } = req.params;

      const completions = await dailyCompletions.getCompletions(req.userId, graphId);
      const today = new Date().toISOString().split('T')[0];

      res.json({
        success: true,
        date: today,
        completions: completions,
        count: completions.length
      });
    } catch (error) {
      logger.error('Failed to get daily completions details:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}

