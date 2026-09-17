/**
 * What happened to a graph, in order, kept long enough to ask about.
 *
 * The graph only says how things are now, and the `history:` snapshots that
 * saveGraph writes expire after an hour. The journal keeps a line per change —
 * with the value it replaced — and a line per agent turn: what was asked,
 * every tool call and its answer, and what was proposed. That is what it
 * takes to answer "what did it just do?" after the fact.
 *
 * One Redis stream per user and graph, capped rather than expiring. Writing to
 * it must never break the thing being recorded, so a failed write is logged
 * and dropped.
 */

import { logger } from '../utils/logger.js';

export const JOURNAL_LENGTH = 5000;

export const journalKey = (userId, graphId) => `journal:${userId}:${graphId}`;

// Recomputed on every tick of progress; a line for each would drown the rest.
const DERIVED_FIELDS = new Set(['calculatedProgress']);
// Sent many times a second while dragging.
const NOT_JOURNALLED = new Set(['UPDATE_NODE_POSITION', 'UPDATE_VIEWPORT']);

const findNode = (nodes, id) => {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const clipText = (text, limit) => {
  const s = String(text ?? '');
  return s.length <= limit ? s : `${s.slice(0, limit - 1)}…`;
};

/**
 * What an operation is about to do, in terms a person can read later.
 * Call it before the operation is applied: the values it replaces are gone
 * afterwards. Returns null for operations not worth a line.
 */
export function describeOperation(graph, operation) {
  const { type, payload = {} } = operation || {};
  if (NOT_JOURNALLED.has(type)) return null;

  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const ref = (id) => ({ id, title: findNode(nodes, id)?.title ?? null });

  switch (type) {
    case 'UPDATE_NODE': {
      const nodeId = payload.id || payload.nodeId;
      const node = findNode(nodes, nodeId);
      const changes = {};
      for (const [field, to] of Object.entries(payload.updates || {})) {
        if (DERIVED_FIELDS.has(field)) continue;
        const from = node?.[field] ?? null;
        if (same(from, to)) continue;
        // A children array is a whole subtree; its size is what is readable.
        changes[field] = field === 'children'
          ? { from: `${(from || []).length} children`, to: `${(to || []).length} children` }
          : { from, to };
      }
      if (Object.keys(changes).length === 0) return null;
      return { type, nodeId, title: node?.title ?? null, changes };
    }

    case 'ADD_NODE':
      return {
        type,
        nodeId: payload.id,
        title: payload.title ?? null,
        nodeType: payload.nodeType ?? null,
        nodeSubtype: payload.nodeSubtype ?? null,
        parent: payload.parentId ? ref(payload.parentId) : null,
      };

    case 'DELETE_NODE': {
      const nodeId = payload.nodeId || payload.id;
      return { type, nodeId, title: findNode(nodes, nodeId)?.title ?? null };
    }

    case 'ADD_EDGE':
      return {
        type,
        edgeId: payload.id,
        source: ref(payload.source),
        target: ref(payload.target),
        duplicate: edges.some((e) => e.id === payload.id || (e.source === payload.source && e.target === payload.target)),
      };

    case 'DELETE_EDGE': {
      const edge = edges.find((e) => e.id === payload.edgeId);
      return {
        type,
        edgeId: payload.edgeId,
        source: edge ? ref(edge.source) : null,
        target: edge ? ref(edge.target) : null,
      };
    }

    default:
      return { type };
  }
}

const quote = (title) => `«${title ?? '?'}»`;
const value = (v) => clipText(JSON.stringify(v ?? null), 80);
const time = (at) => (at ? new Date(at).toLocaleString('sv-SE') : '?');

// The agent answers in paragraphs; in a log they would read as separate entries.
const oneLine = (text) => clipText(String(text ?? '').replace(/\s+/g, ' ').trim(), 300);

const outcome = (result) => {
  if (!result) return 'no result';
  if (result.type === 'changes') {
    const count = result.operations?.length ?? 0;
    return `proposed ${count} operation${count === 1 ? '' : 's'}: ${oneLine(result.summary)}`;
  }
  return `${result.type}: ${oneLine(result.message)}`;
};

/** One entry as the lines a person reads in a terminal. */
/**
 * What a turn cost, on one line. A turn is many API calls — the count is there
 * because a turn that took nine of them is a different animal from one that
 * took two, at the same price.
 */
function spend({ calls = 0, input = 0, output = 0, cacheRead = 0, cacheWrite = 0, dollars = 0 }) {
  const parts = [`${input} in`, `${output} out`];
  if (cacheRead) parts.push(`${cacheRead} cached`);
  if (cacheWrite) parts.push(`${cacheWrite} written`);
  return `$${dollars.toFixed(4)}  ${calls} calls  ${parts.join(', ')}`;
}

export function formatEntry(entry) {
  const when = time(entry.at);

  if (entry.kind === 'agent_turn') {
    const lines = [`${when}  AGENT  ${JSON.stringify(clipText(entry.request, 200))}`];
    for (const call of entry.tools || []) {
      const firstLine = String(call.result ?? '').split('\n')[0];
      lines.push(`    ${call.name} ${JSON.stringify(call.input ?? {})} → ${clipText(firstLine, 120)}`);
    }
    lines.push(`    ⇒ ${outcome(entry.result)}`);
    if (entry.usage) lines.push(`    ${spend(entry.usage)}`);
    return lines.join('\n');
  }

  switch (entry.type) {
    case 'UPDATE_NODE': {
      const changes = Object.entries(entry.changes || {})
        .map(([field, { from, to }]) => `${field}: ${value(from)} → ${value(to)}`)
        .join('; ');
      return `${when}  UPDATE_NODE  ${quote(entry.title)}  ${changes}`;
    }
    case 'ADD_NODE': {
      const where = entry.parent ? `inside ${quote(entry.parent.title)}` : 'at the top level';
      return `${when}  ADD_NODE  ${quote(entry.title)} (${entry.nodeType}/${entry.nodeSubtype}) ${where}`;
    }
    case 'DELETE_NODE':
      return `${when}  DELETE_NODE  ${quote(entry.title)}`;
    case 'ADD_EDGE':
      return `${when}  ADD_EDGE  ${quote(entry.source?.title)} → ${quote(entry.target?.title)}${entry.duplicate ? '  (duplicate: pair already connected, not stored)' : ''}`;
    case 'DELETE_EDGE':
      return entry.source
        ? `${when}  DELETE_EDGE  ${quote(entry.source.title)} → ${quote(entry.target?.title)}`
        : `${when}  DELETE_EDGE  ${entry.edgeId} (no such edge)`;
    default:
      return `${when}  ${entry.type ?? entry.kind}`;
  }
}

export function createJournal(redis) {
  return {
    async record(userId, graphId, entry) {
      try {
        await redis.xadd(
          journalKey(userId, graphId),
          'MAXLEN', '~', String(JOURNAL_LENGTH),
          '*',
          'entry', JSON.stringify({ at: new Date().toISOString(), ...entry }),
        );
      } catch (error) {
        logger.error(`Journal write failed for ${userId}:${graphId}: ${error.message}`);
      }
    },

    /** Newest first. */
    async read(userId, graphId, { limit = 50 } = {}) {
      const rows = await redis.xrevrange(journalKey(userId, graphId), '+', '-', 'COUNT', limit);
      return rows.map(([id, fields]) => ({ id, ...JSON.parse(fields[fields.indexOf('entry') + 1]) }));
    },
  };
}

export default createJournal;
