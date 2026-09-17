/**
 * Graph Service - Extracted from simple-server.js
 *
 * The daily progress reset a graph can opt into through its settings.
 * There is no default user here or anywhere: every graph belongs to the user
 * a token proved.
 */

/**
 * Check if progress should be reset (daily reset logic)
 * Copied from simple-server.js lines 69-92
 */
export function shouldResetProgress(graph) {
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
 * Copied from simple-server.js lines 97-115
 */
export function resetAllProgress(graph) {
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
