/**
 * Analytics Routes - Extracted from simple-server.js
 * REST API endpoints for analytics and progress snapshots
 * Copied from simple-server.js lines 897-1041
 */

import express from 'express';
import { DEFAULT_USER_ID } from '../services/graphService.js';

const router = express.Router();

/**
 * Setup analytics routes with dependencies
 * @param {Object} deps - Dependencies (analytics, progressSnapshots)
 */
export function setupAnalyticsRoutes(deps) {
  const { analytics, progressSnapshots } = deps;

  // Progress comparison endpoint - MUST BE BEFORE :graphId route
  // Copied from simple-server.js lines 897-940
  router.get('/progress-comparison', async (req, res) => {
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
  // Copied from simple-server.js lines 943-967
  router.post('/snapshot', async (req, res) => {
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
  // Copied from simple-server.js lines 970-992
  router.get('/snapshots/:nodeId', async (req, res) => {
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
  // Copied from simple-server.js lines 995-1019
  router.get('/:graphId', async (req, res) => {
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
  // Copied from simple-server.js lines 1022-1041
  router.get('/categories/:graphId', async (req, res) => {
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

  return router;
}

export default router;
