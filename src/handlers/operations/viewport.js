/**
 * UPDATE_VIEWPORT Operation Handler
 * Extracted from operationHandler.js
 */

import { logger } from '../../utils/logger.js';

/**
 * Handle UPDATE_VIEWPORT operation
 * @param {Object} graph - The graph object
 * @param {Object} payload - Viewport data
 * @returns {boolean} - Success status
 */
export function handleUpdateViewport(graph, payload) {
  graph.viewport = payload;
  logger.debug(`Updated viewport: x=${payload.x}, y=${payload.y}, zoom=${payload.zoom}`);
  return true;
}

export default handleUpdateViewport;
