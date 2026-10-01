/** Read-only projection of a proposal. Saved nodes and per-turn aliases stay intact. */
import { buildAliasTable } from './aliases.js';
import { buildLinkIndex } from './links.js';

export function projectDraft(nodes, edges, staged, originalAliases) {
  const roots = structuredClone(nodes);
  const index = new Map(), parents = new Map();
  const walk = (list, parent = null) => { for (const node of list) {
    node.children ||= [];
    index.set(node.id, node); parents.set(node.id, parent);
    walk(node.children, node.id);
  } };
  walk(roots);
  const links = buildLinkIndex(nodes, edges);
  let projectedEdges = [...index.keys()].flatMap((source) => links.downstreamOf(source)
    .map((target) => ({ source, target, direction: 'downstream' })));
  // The canonical edge list above includes both persisted representations.
  for (const node of index.values()) node.linkedNodeIds = {};
  const get = (id) => {
    const node = index.get(id);
    if (!node) throw new Error('A draft operation refers to a missing node.');
    return node;
  };
  const childrenOf = (parent) => parent ? get(parent).children : roots;
  const refreshKind = (parent) => {
    if (!parent) return;
    const node = get(parent);
    if (node.nodeType === 'dao') node.nodeSubtype = node.children.length ? 'withChildren' : 'simple';
  };
  const addLink = (source, target) => {
    get(source); get(target);
    if (source === target) throw new Error('A draft node cannot lead to itself.');
    if (!projectedEdges.some((e) => e.source === source && e.target === target)) {
      projectedEdges.push({ source, target, direction: 'downstream' });
    }
  };

  // The editor creates all additions before applying the other operations.
  for (const op of staged.filter((op) => op.op === 'add')) {
    if (index.has(op.alias)) throw new Error('A draft alias is already taken.');
    index.set(op.alias, { id: op.alias, title: op.title, description: op.description || '',
      nodeType: op.nodeType, nodeSubtype: op.nodeSubtype, isDone: false, children: [], linkedNodeIds: {} });
    parents.set(op.alias, op.parent || null);
  }
  const checkParent = (id, parent) => {
    if (parent) get(parent);
    const seen = new Set([id]);
    for (let cursor = parent; cursor; cursor = parents.get(cursor)) {
      if (seen.has(cursor)) throw new Error('Draft nesting contains a circle.');
      seen.add(cursor);
    }
  };
  for (const op of staged.filter((op) => op.op === 'add')) {
    checkParent(op.alias, op.parent);
    childrenOf(op.parent).push(get(op.alias));
    refreshKind(op.parent);
  }
  for (const op of staged.filter((op) => op.op === 'add')) {
    for (const target of op.downstream || []) addLink(op.alias, target);
  }
  for (const op of staged) {
    if (op.op === 'add') continue;
    if (op.op === 'link') { addLink(op.source, op.target); continue; }
    if (op.op === 'unlink') {
      get(op.source); get(op.target);
      projectedEdges = projectedEdges.filter((e) => !((e.source === op.source && e.target === op.target)
        || (e.source === op.target && e.target === op.source)));
      continue;
    }
    const node = get(op.target);
    if (op.op === 'update') {
      for (const key of ['title', 'description', 'nodeType', 'nodeSubtype']) if (op[key] !== undefined) node[key] = op[key];
    } else if (op.op === 'done') {
      node.isDone = op.isDone;
    } else if (op.op === 'move' || op.op === 'delete') {
      const before = parents.get(node.id);
      if (op.op === 'delete' && node.children.length) throw new Error('A draft deletion would remove a subtree.');
      if (op.op === 'move') checkParent(node.id, op.parent);
      const siblings = childrenOf(before);
      siblings.splice(siblings.indexOf(node), 1);
      refreshKind(before);
      if (op.op === 'move') {
        childrenOf(op.parent).push(node); parents.set(node.id, op.parent || null); refreshKind(op.parent);
      } else {
        index.delete(node.id); parents.delete(node.id);
        projectedEdges = projectedEdges.filter((e) => e.source !== node.id && e.target !== node.id);
      }
    } else throw new Error('Unknown draft operation.');
  }
  return { nodes: roots, edges: projectedEdges,
    aliases: buildAliasTable(roots, (id) => originalAliases.aliasOf(id) || id) };
}
