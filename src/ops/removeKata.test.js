import { test } from 'node:test';
import assert from 'node:assert/strict';

import { removeKata } from './removeKata.js';

const n = (id, extra = {}) => ({ id, title: id, nodeType: 'dao', nodeSubtype: 'simple', children: [], ...extra });
const kata = (id, extra = {}) => n(id, { nodeType: 'repeatable', nodeSubtype: 'bounded', ...extra });

const graph = () => ({
  version: 7,
  nodes: [
    n('area', {
      nodeType: 'fundamental', nodeSubtype: 'category',
      children: [
        n('task'),
        kata('run', { children: [n('inside-run')] }),
        n('mi', { nodeType: 'fundamental', nodeSubtype: 'upstream', linkedNodeIds: { upstream: ['task', 'run'], downstream: [] } }),
      ],
    }),
    kata('water'),
  ],
  edges: [
    { id: 'e1', source: 'task', target: 'mi' },
    { id: 'e2', source: 'run', target: 'mi' },
    { id: 'e3', source: 'inside-run', target: 'task' },
  ],
});

const ids = (nodes) => nodes.flatMap((x) => [x.id, ...ids(x.children || [])]);

test('removes every Kata, nested or not, with what is inside it', () => {
  const { graph: out, removedIds } = removeKata(graph());

  assert.deepEqual(ids(out.nodes).sort(), ['area', 'mi', 'task']);
  assert.deepEqual(removedIds.sort(), ['inside-run', 'run', 'water']);
});

test('leaves no edge and no link pointing at a removed node', () => {
  const { graph: out, edgesRemoved } = removeKata(graph());

  assert.deepEqual(out.edges.map((e) => e.id), ['e1']);
  assert.equal(edgesRemoved, 2);
  const mi = out.nodes[0].children.find((x) => x.id === 'mi');
  assert.deepEqual(mi.linkedNodeIds, { upstream: ['task'], downstream: [] });
});

test('bumps the version only when something changed', () => {
  assert.equal(removeKata(graph()).graph.version, 8);

  const clean = { version: 3, nodes: [n('a')], edges: [] };
  const result = removeKata(clean);
  assert.equal(result.graph, clean);
  assert.deepEqual(result.removedIds, []);
});

test('copes with a graph that has no edges key', () => {
  const { graph: out } = removeKata({ nodes: [kata('k')] });
  assert.deepEqual(out.nodes, []);
  assert.deepEqual(out.edges, []);
});
