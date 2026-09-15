/**
 * What the agent can read.
 *
 * Every function returns a string, because that is what a tool result is, and
 * every failure returns a string too — an exception would end the turn, while
 * a sentence lets the model try something else.
 *
 * The three tools are deliberately different sizes: `overview` is cheap and
 * shows shape, `inspect` is the expensive one and is asked for by name,
 * `search` finds a node when the agent does not know where it is.
 */

import { buildLinkIndex } from './links.js';

const SHORT_DESCRIPTION = 120;

/**
 * The six kinds, named the way the agent names them. This is the only
 * hand-written copy: the reverse lookup below is derived, so the two cannot
 * drift apart and mislabel a node.
 */
export const KIND_TO_TYPES = {
  dao: { nodeType: 'dao', nodeSubtype: 'simple' },
  kata: { nodeType: 'repeatable', nodeSubtype: 'bounded' },
  'kata-infinity': { nodeType: 'repeatable', nodeSubtype: 'infinity' },
  ryu: { nodeType: 'fundamental', nodeSubtype: 'category' },
  kai: { nodeType: 'fundamental', nodeSubtype: 'downstream' },
  mi: { nodeType: 'fundamental', nodeSubtype: 'upstream' },
};

export const KIND_LIST = Object.keys(KIND_TO_TYPES);

const NAME_BY_PAIR = Object.fromEntries(
  Object.entries(KIND_TO_TYPES).map(([name, t]) => [`${t.nodeType}/${t.nodeSubtype}`, name])
);

export const kindNameOf = (node) =>
  NAME_BY_PAIR[`${node.nodeType}/${node.nodeSubtype}`] || 'dao';

const shorten = (text) =>
  !text ? '' : text.length <= SHORT_DESCRIPTION
    ? text
    : `${text.slice(0, SHORT_DESCRIPTION - 1).trimEnd()}…`;

const countDescendants = (node) => {
  let total = 0;
  for (const child of node.children || []) total += 1 + countDescendants(child);
  return total;
};

export function createReadTools(nodes, aliases, edges = []) {
  const links = buildLinkIndex(nodes, edges);

  const line = (entry, { description, indent = 0 }) => {
    const { alias, node } = entry;
    const parts = [`${'  '.repeat(indent)}${alias} [${kindNameOf(node)}] ${node.title}`];

    const inside = countDescendants(node);
    if (inside > 0) parts.push(`${inside} inside`);

    const downstreamLinks = links.downstreamOf(node.id)
      .map((id) => aliases.aliasOf(id))
      .filter(Boolean);
    if (downstreamLinks.length) parts.push(`${alias} → ${downstreamLinks.join(', ')}`);

    const upstreamLinks = links.upstreamOf(node.id)
      .map((id) => aliases.aliasOf(id))
      .filter(Boolean);
    if (upstreamLinks.length) parts.push(`${upstreamLinks.join(', ')} → ${alias}`);

    if (node.isDone) parts.push('done');

    const text = description === 'full' ? node.description : shorten(node.description);
    if (text) parts.push(`"${text}"`);

    return parts.join(' · ');
  };

  return {
    overview() {
      const top = aliases.all.filter((entry) => entry.depth === 0);
      if (top.length === 0) return 'The graph is empty. Nothing exists yet at the top level.';

      return [
        `Top level, ${top.length} node(s). Use inspect(alias) to open one.`,
        ...top.map((entry) => line(entry, { description: 'short' })),
      ].join('\n');
    },

    inspect({ alias, depth = 2 }) {
      const entry = aliases.entryAt(alias);
      if (!entry) return `There is no node called ${alias}. Use overview or search to find the right alias.`;

      const limit = Math.max(1, Math.min(Number(depth) || 2, 6));
      const out = [];
      const CHILDREN_CAP = 40;

      const walk = (current, indent) => {
        out.push(line(current, { description: 'full', indent }));
        if (indent >= limit) {
          const inside = countDescendants(current.node);
          if (inside > 0) out.push(`${'  '.repeat(indent + 1)}… ${inside} more below, inspect ${current.alias} with a greater depth to see them`);
          return;
        }
        const children = current.node.children || [];
        const shown = Math.min(children.length, CHILDREN_CAP);
        for (let i = 0; i < shown; i++) {
          const child = children[i];
          const childEntry = aliases.entryAt(aliases.aliasOf(child.id));
          if (childEntry) walk(childEntry, indent + 1);
        }
        if (children.length > CHILDREN_CAP) {
          const omitted = children.length - CHILDREN_CAP;
          out.push(`${'  '.repeat(indent + 1)}… ${omitted} more below, inspect ${current.alias} with a greater depth to see them`);
        }
      };
      walk(entry, 0);

      return out.join('\n');
    },

    search({ text }) {
      const needle = String(text || '').trim().toLowerCase();
      if (!needle) return 'Give me something to search for.';

      const hits = aliases.all.filter(({ node }) =>
        `${node.title} ${node.description || ''}`.toLowerCase().includes(needle)
      );

      if (hits.length === 0) return `Nothing matches "${text}".`;

      const shown = Math.min(hits.length, 25);
      const results = hits
        .slice(0, shown)
        .map((entry) => {
          const path = aliases.pathOf(entry.alias);
          const where = path.length ? ` — inside ${path.join(' › ')}` : '';
          return `${line(entry, { description: 'short' })}${where}`;
        })
        .join('\n');

      if (hits.length > shown) {
        const more = hits.length - shown;
        return `${results}\n\n${more} more matched but are not shown here.`;
      }

      return results;
    },
  };
}

export default createReadTools;
