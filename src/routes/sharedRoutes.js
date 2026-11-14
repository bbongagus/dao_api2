/**
 * Shared plans — one plan of a graph, published as a page that anyone with
 * its link can open, with no account (Decision 045).
 *
 * Three records, none of which matches `user:*:graph:*`, so graph scans pass
 * them by:
 *
 *   shared:<slug>            the copy that is served: the plan's node with
 *                            everything inside it, and the arrows between
 *                            those nodes. Nobody's ticks, no option taken,
 *                            and nothing that says whose plan it is.
 *   shared:<slug>:owner      whose it is, for publishing again and taking it
 *                            down. Never served.
 *   user:<userId>:shares     a hash, "<graphId>:<nodeId>" → slug, so a second
 *                            publish of the same plan updates the same page.
 *
 * The page is a copy, not a view: what the owner changes afterwards shows
 * only when they publish again, and a reader's own ticks stay in the reader's
 * browser. Publishing and taking down sit behind requireUser (server.js);
 * reading is mounted outside `/api` and asks nobody who they are.
 */

import express from 'express';
import { randomBytes } from 'node:crypto';
import { cleanFork } from '../ai/forks.js';
import { logger } from '../utils/logger.js';

export const sharedKey = (slug) => `shared:${slug}`;
const ownerKey = (slug) => `${sharedKey(slug)}:owner`;
const sharesKey = (userId) => `user:${userId}:shares`;

// A slug is 12 characters of base64url: 72 random bits. Anything else in the
// address is not a slug, and is answered 404 before a key is built from it.
const SLUG = /^[A-Za-z0-9_-]{12}$/;
const newSlug = () => randomBytes(9).toString('base64url');

// A page is one plan, not a whole graph.
const MAX_NODES = 500;
const MAX_ID = 128;

const text = (value) => (typeof value === 'string' ? value : '');
const number = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/**
 * A node as the page serves it: what the app draws, and nothing else. Ticks,
 * their times, counts and a fork's choice are the owner's own walk through
 * the plan, so the copy starts without them; fields the app does not know
 * are left behind, whatever an update once stored there.
 */
export function publishedCopy(node) {
  return {
    id: text(node.id),
    title: text(node.title),
    description: text(node.description),
    nodeType: text(node.nodeType) || 'dao',
    nodeSubtype: text(node.nodeSubtype) || 'simple',
    isDone: false,
    doneAt: null,
    currentCompletions: 0,
    requiredCompletions: Math.max(1, number(node.requiredCompletions, 1)),
    position: { x: number(node.position?.x, 0), y: number(node.position?.y, 0) },
    children: (Array.isArray(node.children) ? node.children : []).map(publishedCopy),
    ...cleanFork(node),
    choice: null,
  };
}

const find = (nodes, id) => {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const inside = find(node.children, id);
    if (inside) return inside;
  }
  return null;
};

const idsOf = (node, into = new Set()) => {
  into.add(node.id);
  (node.children || []).forEach((child) => idsOf(child, into));
  return into;
};

const parse = (raw) => {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

/**
 * Publishing, listing and taking down: the owner's side.
 * @param {object} deps
 * @param {object} deps.redis - get, set, del, hget, hset, hdel, hgetall
 * @param {(graphId: string, userId: string) => Promise<{nodes, edges}>} deps.getGraph
 * @param {() => Date} [deps.now]
 */
export function setupSharedRoutes({ redis, getGraph, now = () => new Date() }) {
  // Per call, not per module: see graphRoutes.js.
  const router = express.Router();

  router.post('/graphs/:graphId/shares', async (req, res) => {
    try {
      const { graphId } = req.params;
      const nodeId = req.body?.nodeId;
      if (typeof nodeId !== 'string' || nodeId.length === 0 || nodeId.length > MAX_ID) {
        return res.status(400).json({ error: 'nodeId must name the plan to publish' });
      }

      const graph = await getGraph(graphId, req.userId);
      const plan = find(graph?.nodes, nodeId);
      if (!plan) return res.status(404).json({ error: 'There is no such node in this graph.' });

      const inside = idsOf(plan);
      if (inside.size > MAX_NODES) {
        return res.status(413).json({ error: `A page holds one plan of up to ${MAX_NODES} nodes; this one has ${inside.size}.` });
      }

      const field = `${graphId}:${nodeId}`;
      const known = await redis.hget(sharesKey(req.userId), field);
      const slug = known && SLUG.test(known) ? known : newSlug();
      const publishedAt = now().toISOString();
      const page = {
        slug,
        title: text(plan.title),
        publishedAt,
        nodes: [publishedCopy(plan)],
        edges: (graph.edges || [])
          .filter((edge) => inside.has(edge.source) && inside.has(edge.target))
          .map((edge) => ({
            id: text(edge.id), source: edge.source, target: edge.target,
            type: text(edge.type) || 'floating', direction: text(edge.direction) || 'downstream',
          })),
      };

      await redis.set(sharedKey(slug), JSON.stringify(page));
      await redis.set(ownerKey(slug), JSON.stringify({ userId: req.userId, graphId, nodeId }));
      await redis.hset(sharesKey(req.userId), field, slug);
      return res.json({ slug, publishedAt });
    } catch (error) {
      logger.error('Publishing a plan failed:', error);
      return res.status(500).json({ error: 'The plan could not be published.' });
    }
  });

  router.get('/graphs/:graphId/shares', async (req, res) => {
    try {
      const prefix = `${req.params.graphId}:`;
      const all = (await redis.hgetall(sharesKey(req.userId))) || {};
      const shares = [];
      for (const [field, slug] of Object.entries(all)) {
        if (!field.startsWith(prefix)) continue;
        const page = parse(await redis.get(sharedKey(slug)));
        if (!page) continue;
        shares.push({ nodeId: field.slice(prefix.length), slug, title: text(page.title), publishedAt: page.publishedAt });
      }
      return res.json({ shares });
    } catch (error) {
      logger.error('Listing published plans failed:', error);
      return res.status(500).json({ error: 'The published plans could not be listed.' });
    }
  });

  router.delete('/shares/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      const owner = SLUG.test(slug) ? parse(await redis.get(ownerKey(slug))) : null;
      // Someone else's page is, to this account, a page that does not exist.
      if (!owner || owner.userId !== req.userId) return res.status(404).json({ error: 'There is no such page.' });
      await redis.del(sharedKey(slug), ownerKey(slug));
      await redis.hdel(sharesKey(req.userId), `${owner.graphId}:${owner.nodeId}`);
      return res.json({ removed: true });
    } catch (error) {
      logger.error('Taking a published plan down failed:', error);
      return res.status(500).json({ error: 'The page could not be taken down.' });
    }
  });

  return router;
}

/**
 * The page itself: mounted outside `/api`, read by anyone who has the link.
 * @param {object} deps
 * @param {object} deps.redis - get
 */
export function setupSharedReadRoutes({ redis }) {
  const router = express.Router();

  router.get('/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      const page = SLUG.test(slug) ? parse(await redis.get(sharedKey(slug))) : null;
      if (!page) return res.status(404).json({ error: 'There is no such page.' });
      // The copy changes only when its owner publishes again.
      res.set('Cache-Control', 'public, max-age=30');
      return res.json({
        slug: page.slug, title: page.title, publishedAt: page.publishedAt, nodes: page.nodes, edges: page.edges,
      });
    } catch (error) {
      logger.error('Reading a published plan failed:', error);
      return res.status(500).json({ error: 'The page could not be read.' });
    }
  });

  return router;
}
