/**
 * Daily Habit Counter Service
 * Automatically increments totalCompletions for infinity-mode repeatable nodes at midnight
 * if they were marked as done that day
 */

import { logger } from '../utils/logger.js';
import redis from '../redis.js';

export const DEFAULT_USER_ID = '1';

class DailyHabitCounterService {
  /**
   * Find all infinity-mode repeatable nodes in a graph
   */
  findInfinityNodes(nodes, infinityNodes = []) {
    for (const node of nodes) {
      if (node.nodeType === 'repeatable' && node.nodeSubtype === 'infinity') {
        infinityNodes.push(node);
      }
      if (node.children && Array.isArray(node.children)) {
        this.findInfinityNodes(node.children, infinityNodes);
      }
    }
    return infinityNodes;
  }

  /**
   * Process all graphs and increment counters for completed infinity nodes
   * Called at 00:00 every day
   */
  async processAllGraphs(userId = DEFAULT_USER_ID) {
    logger.info(`🔄 Daily Habit Counter: Processing all graphs for user ${userId}...`);

    try {
      // Get user's main graph
      const graphKey = `user:${userId}:graph:main`;
      const graphData = await redis.get(graphKey);

      if (!graphData) {
        logger.warn(`No graph found for user ${userId}`);
        return { processedCount: 0, incrementedCount: 0 };
      }

      const graph = JSON.parse(graphData);
      const infinityNodes = this.findInfinityNodes(graph.nodes);

      logger.info(`📊 Found ${infinityNodes.length} infinity-mode nodes`);

      let incrementedCount = 0;

      // Process each infinity node
      for (const node of infinityNodes) {
        if (node.isDone) {
          // Node was completed today - increment counter
          const previousCount = node.currentCompletions || 0;
          node.currentCompletions = previousCount + 1;
          node.isDone = false; // Reset for next day

          logger.success(
            `✅ Incremented habit counter for "${node.title}": ${previousCount} → ${node.currentCompletions}`
          );
          incrementedCount++;
        }
      }

      // Save modified graph back to Redis
      if (incrementedCount > 0) {
        await redis.set(graphKey, JSON.stringify(graph));
        logger.success(`💾 Saved updated graph (${incrementedCount} nodes updated)`);
      }

      logger.info(`✨ Daily Habit Counter complete: ${incrementedCount} nodes incremented`);
      return {
        processedCount: infinityNodes.length,
        incrementedCount: incrementedCount
      };
    } catch (error) {
      logger.error('❌ Daily Habit Counter failed:', error);
      throw error;
    }
  }
}

export default new DailyHabitCounterService();
