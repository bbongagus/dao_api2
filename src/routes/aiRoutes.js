/**
 * AI Routes - Extracted from simple-server.js
 * REST API endpoints for AI planning
 * Copied from simple-server.js lines 1044-1088
 */

import express from 'express';

const router = express.Router();

/**
 * Setup AI routes
 */
export function setupAIRoutes() {
  // AI Planning endpoint (dynamic import to avoid startup crash if API key missing)
  // Copied from simple-server.js lines 1044-1088
  router.post('/generate-plan', async (req, res) => {
    // DIAGNOSTIC: Log that this route is being hit
    console.log('🔍 [Server] /api/ai/generate-plan endpoint HIT');
    console.log('🔍 [Server] Request headers:', req.headers);
    console.log('🔍 [Server] Request body:', JSON.stringify(req.body).substring(0, 200));
    
    try {
      const { messages } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        console.error('🔍 [Server] Invalid request - missing messages array');
        return res.status(400).json({
          success: false,
          error: 'messages array is required'
        });
      }
      
      console.log('🤖 Generating AI plan for messages:', messages.length);
      
      // Dynamic import - only loads when endpoint is called
      const aiPlanningModule = await import('../ai-planning.js');
      const aiPlanning = aiPlanningModule.default;
      
      // Format and send to AI
      const formattedMessages = aiPlanning.formatMessagesForAPI(messages);
      const response = await aiPlanning.sendMessageToAI(formattedMessages);
      
      console.log('🔍 [Server] Sending successful response');
      res.json({
        success: true,
        response
      });
    } catch (error) {
      console.error('🔍 [Server] AI planning error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      console.error('❌ AI planning error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // DIAGNOSTIC: Log that the route has been registered
  console.log('🔍 [Server] AI Planning route registered at POST /api/ai/generate-plan');

  return router;
}

export default router;
