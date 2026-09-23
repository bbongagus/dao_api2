/**
 * Drop edges (and linkedNodeIds) that name nodes no longer in the graph, from
 * every stored graph. Dry run unless --apply. They were left by deletes before
 * 2026-09-23 (src/ops/pruneOrphanEdges.js says how).
 *
 * Writes outside the server's per-graph queue, safely: each key is WATCHed and
 * written in a MULTI/EXEC, so a save that lands in between is not overwritten —
 * that graph is skipped and reported, and running again picks it up. Take a
 * backup first (scripts/redis-backup.js).
 *
 * Usage: REDIS_URL=redis://localhost:6379 node scripts/prune-orphan-edges.js [--apply]
 *        railway run -s Redis -- node scripts/prune-orphan-edges.js [--apply]   (production)
 */

import Redis from 'ioredis';

import { opsRedisUrl } from '../src/ops/redisTarget.js';
import { maskUserId } from '../src/ops/census.js';
import { pruneOrphanEdges } from '../src/ops/pruneOrphanEdges.js';
import { rewriteGraphAt } from '../src/ops/rewriteGraphAt.js';
import { scanGraphKeys } from '../src/services/graphKeys.js';

const apply = process.argv.includes('--apply');

let host;
try {
  const redis = new Redis(opsRedisUrl(process.env), { family: 0, maxRetriesPerRequest: 2 });
  host = `${redis.options.host}:${redis.options.port}`;
  console.error(`${apply ? 'writing' : 'dry run, reading'} ${host}`);
  try {
    let graphs = 0;
    let scanned = 0;
    let edges = 0;
    let links = 0;
    let skipped = 0;
    for await (const { key, userId, graphId } of scanGraphKeys(redis)) {
      scanned += 1;
      const graph = `${maskUserId(userId)} ${graphId}`;
      const { outcome, counts } = await rewriteGraphAt(redis, key, (stored) => {
        const result = pruneOrphanEdges(stored);
        if (result.edgesRemoved + result.linksRemoved === 0) return null;
        return { graph: result.graph, counts: { edges: result.edgesRemoved, links: result.linksRemoved } };
      }, { apply });
      if (outcome === 'unparseable') {
        console.log(`${graph}: unparseable, skipped`);
      } else if (outcome === 'raced') {
        skipped += 1;
        console.log(`${graph}: changed while reading, skipped — run again`);
      } else if (outcome === 'changed' || outcome === 'would-change') {
        graphs += 1;
        edges += counts.edges;
        links += counts.links;
        console.log(`${graph}: ${counts.edges} edges, ${counts.links} linkedNodeIds`);
      }
    }
    const summary = `${apply ? 'removed' : 'would remove'} ${edges} edges and ${links} linkedNodeIds in ${graphs} of ${scanned} graphs`;
    console.log(apply ? `${summary}, skipped ${skipped} that changed while reading` : summary);
  } finally {
    redis.disconnect();
  }
} catch (error) {
  // Never the error object: ioredis attaches the failing command and its key.
  console.error(host ? `${host}: ${error.message}` : error.message);
  process.exit(1);
}
