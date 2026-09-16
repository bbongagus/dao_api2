/**
 * A census of stored graphs: one line per graph with its size and a
 * fingerprint of exactly what is stored. Two censuses taken before and after
 * a deploy are compared with diff — equal lines mean untouched graphs.
 */

import { createHash } from 'node:crypto';

import { scanGraphKeys } from '../services/graphKeys.js';

/** Provider ids (google-oauth2|…, auth0|…) identify real people; the rest are ours. */
export function maskUserId(userId) {
  const bar = userId.indexOf('|');
  if (bar === -1) return userId;
  const digest = createHash('sha256').update(userId).digest('hex').slice(0, 6);
  return `${userId.slice(0, bar)}|~${digest}`;
}

export function countNodes(nodes) {
  return (nodes || []).reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

export function censusLine({ userId, graphId, raw }) {
  const who = `${maskUserId(userId)} ${graphId}`;
  const sha = createHash('sha256').update(raw).digest('hex').slice(0, 12);
  try {
    const graph = JSON.parse(raw);
    return `${who} nodes=${countNodes(graph.nodes)} edges=${(graph.edges || []).length} sha=${sha}`;
  } catch {
    return `${who} unparseable sha=${sha}`;
  }
}

export async function takeCensus(redis) {
  const lines = [];
  for await (const { key, userId, graphId } of scanGraphKeys(redis)) {
    const raw = await redis.get(key);
    if (raw !== null) lines.push(censusLine({ userId, graphId, raw }));
  }
  return lines.sort().join('\n') + '\n';
}
