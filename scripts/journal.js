/**
 * Print a graph's journal: every change, and every agent turn, newest last.
 *
 * Usage: npm run journal -- [userId] [graphId] [limit]
 *        npm run journal -- dev-user-1 main 100
 *
 * Reads whichever Redis the environment points at, the same way the server
 * does — locally that is .env, so it can be production if .env says so.
 */

import redis from '../src/redis.js';
import { createJournal, formatEntry } from '../src/services/journal.js';

const [userId = 'dev-user-1', graphId = 'main', limit = '50'] = process.argv.slice(2);

try {
  const entries = await createJournal(redis).read(userId, graphId, { limit: Number(limit) || 50 });
  if (entries.length === 0) {
    console.log(`No journal for ${userId}:${graphId}.`);
  } else {
    // Stored newest first; a log reads oldest first.
    for (const entry of entries.reverse()) console.log(formatEntry(entry));
  }
} finally {
  redis.disconnect();
}
