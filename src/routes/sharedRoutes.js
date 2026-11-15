/**
 * Shared plans — one plan of a graph, published as a page that anyone with
 * its link can open, with no account (Decision 045).
 *
 * Three records, none of which matches `user:*:graph:*`, so graph scans pass
 * them by:
 *
 *   shared:<slug>            the page, as the very text that is served: the
 *                            plan's node with everything inside it, and the
 *                            arrows between those nodes. Nobody's ticks, no
 *                            option taken, and nothing that says whose plan
 *                            it is.
 *   shared:<slug>:owner      whose it is, with its title and date, for
 *                            listing, publishing again and taking it down.
 *                            Never served.
 *   user:<userId>:shares     a hash, the plan (its graph and node) → slug, so
 *                            a second publish of the same plan updates the
 *                            same page.
 *
 * The page is a copy, not a view: what the owner changes afterwards shows
 * only when they publish again, and a reader's own ticks stay in the reader's
 * browser. Publishing and taking down sit behind requireUser (server.js);
 * reading is mounted outside `/api` and asks nobody who they are.
 *
 * A page is bounded — nodes, arrows, bytes, and pages per account — because
 * the read is free to anyone: what an account can store here, a stranger can
 * make the server fetch and send.
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
const MAX_EDGES = 2000;
const MAX_BYTES = 512 * 1024;
const MAX_PAGES = 50;
const MAX_ID = 128;

// The plan's place in the account's hash. Length first, so a graph `a` with
// a node `b:c` and a graph `a:b` with a node `c` are two plans, not one.
const fieldOf = (graphId, nodeId) => `${graphId.length}:${graphId}:${nodeId}`;
const fieldsOf = (graphId) => `${graphId.length}:${graphId}:`;

const text = (value) => (typeof value === 'string' ? value : '');
const number = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/**
 * A node as the page serves it: what the app draws, and nothing else. Ticks,
 * their times, counts and a fork's choice are the owner's own walk through
 * the plan, so the copy starts without them; fields the app does not know
 * are left behind, whatever an update once stored there.
 *
 * A fork's option names are kept only for the options it has: the steps its
 * arrows lead to, inside what is published. The node keeps a name for every
 * option it ever had — a step since deleted, an arrow since taken away —
 * and none of that is the page's to show.
 *
 * @param {object} node
 * @param {(id: string) => Set<string>} [arrowsFrom] - where a node's arrows
 *   lead, among the nodes being published
 */
export function publishedCopy(node, arrowsFrom = () => new Set()) {
  const fork = cleanFork(node);
  const options = fork.fork ? arrowsFrom(node.id) : new Set();
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
    children: (Array.isArray(node.children) ? node.children : []).map((child) => publishedCopy(child, arrowsFrom)),
    fork: fork.fork,
    choice: null,
    forkOptions: fork.forkOptions.filter((option) => options.has(option.target)),
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

/** Every node of the plan, counted as it is walked: two that share an id are two. */
function walked(node, ids = new Set()) {
  let count = 1;
  ids.add(node.id);
  for (const child of Array.isArray(node.children) ? node.children : []) count += walked(child, ids).count;
  return { count, ids };
}

const parse = (raw) => {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

class Refusal extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Publishing, listing and taking down: the owner's side.
 * @param {object} deps
 * @param {object} deps.redis - get, set, del, hget, hset, hdel, hgetall
 * @param {(graphId: string, userId: string) => Promise<{nodes, edges}>} deps.getGraph
 * @param {{ enqueue: (key: string, run: () => Promise<any>) => Promise<any> }} [deps.graphQueue] -
 *   the queue the graph's operations run through (server.js). Publishing
 *   takes its turn in it: the copy is of the graph between two operations,
 *   never of one half applied, and two publishes of one plan cannot both
 *   find it unpublished.
 * @param {() => Date} [deps.now]
 */
export function setupSharedRoutes({ redis, getGraph, graphQueue, now = () => new Date() }) {
  // Per call, not per module: see graphRoutes.js.
  const router = express.Router();
  const inTurn = (userId, graphId, run) => (graphQueue ? graphQueue.enqueue(`${userId}:${graphId}`, run) : run());

  async function publish(userId, graphId, nodeId) {
    const graph = await getGraph(graphId, userId);
    const plan = find(graph?.nodes, nodeId);
    if (!plan) throw new Refusal(404, 'There is no such node in this graph.');

    const { count, ids: inside } = walked(plan);
    if (count > MAX_NODES) {
      throw new Refusal(413, `A page holds one plan of up to ${MAX_NODES} nodes; this one has ${count}.`);
    }
    const edges = (Array.isArray(graph.edges) ? graph.edges : [])
      .filter((edge) => edge && inside.has(edge.source) && inside.has(edge.target))
      .map((edge) => ({
        id: text(edge.id), source: edge.source, target: edge.target,
        type: text(edge.type) || 'floating', direction: text(edge.direction) || 'downstream',
      }));
    if (edges.length > MAX_EDGES) {
      throw new Refusal(413, `A page holds a plan of up to ${MAX_EDGES} arrows; this one has ${edges.length}.`);
    }

    // Where each node's arrows lead, read in time as the app reads them: an
    // arrow stored backwards (`upstream`) leaves its target.
    const leads = new Map();
    for (const edge of edges) {
      if (edge.direction === 'neutral') continue;
      const [from, to] = edge.direction === 'upstream' ? [edge.target, edge.source] : [edge.source, edge.target];
      if (!leads.has(from)) leads.set(from, new Set());
      leads.get(from).add(to);
    }
    const arrowsFrom = (id) => leads.get(id) || new Set();

    const field = fieldOf(graphId, nodeId);
    const all = (await redis.hgetall(sharesKey(userId))) || {};
    const known = all[field];
    if (!known && Object.keys(all).length >= MAX_PAGES) {
      throw new Refusal(409, `An account holds up to ${MAX_PAGES} pages. Take one down to publish another.`);
    }
    const slug = known && SLUG.test(known) ? known : newSlug();
    const publishedAt = now().toISOString();
    const title = text(plan.title);

    const page = JSON.stringify({ slug, title, publishedAt, nodes: [publishedCopy(plan, arrowsFrom)], edges });
    const bytes = Buffer.byteLength(page);
    if (bytes > MAX_BYTES) {
      throw new Refusal(413, `A page holds up to ${MAX_BYTES / 1024} KB; this plan is ${Math.ceil(bytes / 1024)} KB. Shorten its descriptions or publish a part of it.`);
    }

    // The owner first: a page must never stand where nobody can take it down.
    await redis.set(ownerKey(slug), JSON.stringify({ userId, graphId, nodeId, title, publishedAt }));
    await redis.hset(sharesKey(userId), field, slug);
    await redis.set(sharedKey(slug), page);
    return { slug, publishedAt };
  }

  router.post('/graphs/:graphId/shares', async (req, res) => {
    try {
      const { graphId } = req.params;
      const nodeId = req.body?.nodeId;
      if (typeof nodeId !== 'string' || nodeId.length === 0 || nodeId.length > MAX_ID) {
        return res.status(400).json({ error: 'nodeId must name the plan to publish' });
      }
      if (graphId.length > MAX_ID) return res.status(400).json({ error: 'graphId is too long' });
      return res.json(await inTurn(req.userId, graphId, () => publish(req.userId, graphId, nodeId)));
    } catch (error) {
      if (error instanceof Refusal) return res.status(error.status).json({ error: error.message });
      logger.error('Publishing a plan failed:', error);
      return res.status(500).json({ error: 'The plan could not be published.' });
    }
  });

  router.get('/graphs/:graphId/shares', async (req, res) => {
    try {
      const prefix = fieldsOf(req.params.graphId);
      const all = (await redis.hgetall(sharesKey(req.userId))) || {};
      const shares = [];
      for (const [field, slug] of Object.entries(all)) {
        if (!field.startsWith(prefix) || !SLUG.test(slug)) continue;
        // The owner's record says what the list needs; the page is not read.
        const owner = parse(await redis.get(ownerKey(slug)));
        if (!owner || owner.userId !== req.userId) continue;
        shares.push({ nodeId: field.slice(prefix.length), slug, title: text(owner.title), publishedAt: owner.publishedAt });
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
      // The page first, so it stops being served; then what pointed at it —
      // and the plan's place in the list only if it is this page it names.
      await redis.del(sharedKey(slug), ownerKey(slug));
      const field = fieldOf(text(owner.graphId), text(owner.nodeId));
      if ((await redis.hget(sharesKey(req.userId), field)) === slug) await redis.hdel(sharesKey(req.userId), field);
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
 * What is stored is the text that is served, so a read is one fetch and one
 * send, with nothing parsed.
 * @param {object} deps
 * @param {object} deps.redis - get
 */
export function setupSharedReadRoutes({ redis }) {
  const router = express.Router();

  router.get('/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      const page = SLUG.test(slug) ? await redis.get(sharedKey(slug)) : null;
      if (typeof page !== 'string' || page === '') return res.status(404).json({ error: 'There is no such page.' });
      // The reader's own browser may keep it half a minute; nothing between
      // the server and the reader may: a page taken down has to be gone.
      res.set('Cache-Control', 'private, max-age=30');
      return res.type('application/json').send(page);
    } catch (error) {
      logger.error('Reading a published plan failed:', error);
      return res.status(500).json({ error: 'The page could not be read.' });
    }
  });

  return router;
}
