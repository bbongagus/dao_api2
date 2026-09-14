/**
 * Showing the model the graph it is about to change.
 *
 * Two problems this solves. Real node ids are uuids: thirty-six characters
 * each, which is both expensive and easy for a model to mistype or invent.
 * And an operation that names a node which does not exist must never reach
 * the editor.
 *
 * So nodes are presented under short aliases (n1, n2, …), the mapping stays
 * here on the server, and anything addressed to an unknown alias is dropped
 * on the way back.
 */

// Enough to recognise a node, not enough for one node to crowd out the rest.
const DESCRIPTION_LIMIT = 120;

const truncate = (text) =>
  !text ? '' : text.length <= DESCRIPTION_LIMIT
    ? text
    : `${text.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…`;

/**
 * Flatten the level into aliased entries and a block of text for the prompt.
 * @returns {{ text: string, aliasToId: Record<string,string>, count: number }}
 */
export function buildGraphContext(nodes) {
  const aliasToId = {};
  const idToAlias = new Map();
  const flat = [];

  const walk = (list, depth) => {
    for (const node of list || []) {
      const alias = `n${flat.length + 1}`;
      aliasToId[alias] = node.id;
      idToAlias.set(node.id, alias);
      flat.push({ alias, node, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);

  if (flat.length === 0) {
    return { text: 'The graph is empty at this level.', aliasToId, count: 0 };
  }

  const lines = flat.map(({ alias, node, depth }) => {
    const indent = '  '.repeat(depth);
    const kind = `${node.nodeType || 'dao'}/${node.nodeSubtype || 'simple'}`;
    const links = (node.linkedNodeIds?.downstream || [])
      .map((id) => idToAlias.get(id))
      .filter(Boolean);

    const parts = [`${indent}${alias} [${kind}] ${node.title}`];
    if (links.length) parts.push(`${alias} → ${links.join(', ')}`);
    if (node.isDone) parts.push('done');
    const description = truncate(node.description);
    if (description) parts.push(`"${description}"`);

    return parts.join(' · ');
  });

  return {
    text: `Current graph (${flat.length} nodes):\n${lines.join('\n')}`,
    aliasToId,
    count: flat.length,
  };
}

/**
 * Turn the model's aliases back into real ids.
 *
 * An alias the context never handed out refers to nothing, so the operation
 * is dropped rather than guessed at. Aliases minted by the model for nodes it
 * is adding have no real id yet and are left as they are - the client
 * resolves them once the nodes exist.
 */
export function resolveAliases(operations, aliasToId) {
  const added = new Set(
    (operations || []).filter((op) => op.op === 'add' && op.alias).map((op) => op.alias)
  );

  const resolve = (ref) => {
    if (aliasToId[ref]) return aliasToId[ref];
    if (added.has(ref)) return ref; // a node being created in this same batch
    return null;
  };

  const resolved = [];

  for (const op of operations || []) {
    if (op.op === 'add') {
      resolved.push({
        ...op,
        downstream: (op.downstream || []).map(resolve).filter(Boolean),
      });
      continue;
    }

    const target = resolve(op.target);
    if (!target) continue;

    if (op.op === 'link' || op.op === 'unlink') {
      const source = resolve(op.source);
      if (!source || source === target) continue;
      resolved.push({ ...op, source, target });
      continue;
    }

    resolved.push({ ...op, target });
  }

  return resolved;
}
