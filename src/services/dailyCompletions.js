/**
 * Daily Completions Service
 * Tracks which nodes were completed today for visual reset feature
 * 
 * Redis Structure:
 *   Key: daily:completions:{userId}:{graphId}:{YYYYMMDD}
 *   Type: Sorted Set (ZSET)
 *   Score: timestamp
 *   Value: nodeId
 *   TTL: 48 hours
 */

import redis from '../redis.js';
import { logger } from '../utils/logger.js';

class DailyCompletionsService {
  /**
   * Get date key in YYYYMMDD format
   */
  getDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  /**
   * Get Redis key for daily completions
   */
  getRedisKey(userId, graphId, date = new Date()) {
    const dateKey = this.getDateKey(date);
    return `daily:completions:${userId}:${graphId}:${dateKey}`;
  }

  /**
   * Add node to today's completions
   * Called when isDone changes from false to true
   */
  async addCompletion(userId, graphId, nodeId) {
    try {
      const key = this.getRedisKey(userId, graphId);
      const timestamp = Date.now();
      
      await redis.zadd(key, timestamp, nodeId);
      await redis.expire(key, 48 * 60 * 60); // 48 hours TTL
      
      logger.info(`📅 Daily completion added: ${nodeId} for user ${userId}`);
      return { nodeId, timestamp };
    } catch (error) {
      logger.error('Failed to add daily completion:', error);
      throw error;
    }
  }

  /**
   * Remove node from today's completions
   * Called when isDone changes from true to false
   */
  async removeCompletion(userId, graphId, nodeId) {
    try {
      const key = this.getRedisKey(userId, graphId);
      await redis.zrem(key, nodeId);
      
      logger.info(`📅 Daily completion removed: ${nodeId} for user ${userId}`);
      return true;
    } catch (error) {
      logger.error('Failed to remove daily completion:', error);
      throw error;
    }
  }

  /**
   * Get all completions for today with timestamps
   */
  async getCompletions(userId, graphId, date = new Date()) {
    try {
      const key = this.getRedisKey(userId, graphId, date);
      const completions = await redis.zrange(key, 0, -1, 'WITHSCORES');
      
      const result = [];
      for (let i = 0; i < completions.length; i += 2) {
        result.push({
          nodeId: completions[i],
          timestamp: parseInt(completions[i + 1])
        });
      }
      
      logger.debug(`📅 Got ${result.length} daily completions for user ${userId}`);
      return result;
    } catch (error) {
      logger.error('Failed to get daily completions:', error);
      return [];
    }
  }

  /**
   * Get just the node IDs (for frontend state)
   */
  async getCompletionIds(userId, graphId, date = new Date()) {
    try {
      const key = this.getRedisKey(userId, graphId, date);
      const ids = await redis.zrange(key, 0, -1);
      
      logger.debug(`📅 Got ${ids.length} completion IDs for user ${userId}`);
      return ids;
    } catch (error) {
      logger.error('Failed to get completion IDs:', error);
      return [];
    }
  }

  /**
   * Get count of today's completions
   */
  async getCount(userId, graphId, date = new Date()) {
    try {
      const key = this.getRedisKey(userId, graphId, date);
      const count = await redis.zcard(key);
      return count || 0;
    } catch (error) {
      logger.error('Failed to get completion count:', error);
      return 0;
    }
  }

  /**
   * Check if a node was completed today
   */
  async isCompletedToday(userId, graphId, nodeId, date = new Date()) {
    try {
      const key = this.getRedisKey(userId, graphId, date);
      const score = await redis.zscore(key, nodeId);
      return score !== null;
    } catch (error) {
      logger.error('Failed to check completion:', error);
      return false;
    }
  }

  /**
   * Clear all today's completions (manual reset)
   */
  async clearCompletions(userId, graphId, date = new Date()) {
    try {
      const key = this.getRedisKey(userId, graphId, date);
      await redis.del(key);
      
      logger.info(`📅 Cleared daily completions for user ${userId}`);
      return true;
    } catch (error) {
      logger.error('Failed to clear completions:', error);
      return false;
    }
  }
}

// Export singleton instance
export default new DailyCompletionsService();
