/**
 * Per-turn names for the nodes in a graph.
 *
 * Real ids are uuids: thirty-six characters the model pays for and can
 * mistype or invent. Inside a turn every node is n1, n2, … instead, and the
 * table that maps them back never leaves the server.
 *
 * The walk is depth first and in document order, so the same graph always
 * yields the same table — which makes a turn reproducible and the aliases
 * stable across the reads within it.
 */

export function buildAliasTable(nodes) {
  const all = [];
  const byAlias = new Map();
  const byId = new Map();
  const ancestorsOf = new Map();

  const walk = (list, parentAlias, ancestors) => {
    for (const node of list || []) {
      const alias = `n${all.length + 1}`;
      const entry = { alias, node, parentAlias, depth: ancestors.length };

      all.push(entry);
      byAlias.set(alias, entry);
      byId.set(node.id, alias);
      ancestorsOf.set(alias, ancestors);

      walk(node.children, alias, [...ancestors, node.title]);
    }
  };
  walk(nodes, null, []);

  return {
    all,
    size: all.length,
    aliasOf: (id) => byId.get(id) ?? null,
    nodeAt: (alias) => byAlias.get(alias)?.node ?? null,
    entryAt: (alias) => byAlias.get(alias) ?? null,
    pathOf: (alias) => ancestorsOf.get(alias) ?? [],
  };
}

export default buildAliasTable;
