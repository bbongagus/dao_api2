import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAliasTable } from './aliases.js';

const n = (id, title, children = []) => ({
  id, title, nodeType: 'dao', nodeSubtype: 'simple',
  description: '', children, linkedNodeIds: {},
});

test('aliases are handed out depth first and start at n1', () => {
  const t = buildAliasTable([n('a', 'A', [n('a1', 'A1')]), n('b', 'B')]);

  assert.equal(t.aliasOf('a'), 'n1');
  assert.equal(t.aliasOf('a1'), 'n2');
  assert.equal(t.aliasOf('b'), 'n3');
  assert.equal(t.size, 3);
});

test('the same graph always produces the same table', () => {
  const graph = [n('a', 'A', [n('a1', 'A1')]), n('b', 'B')];
  const first = buildAliasTable(graph);
  const second = buildAliasTable(graph);

  assert.deepEqual(
    first.all.map((e) => [e.alias, e.node.id]),
    second.all.map((e) => [e.alias, e.node.id])
  );
});

test('a node can be found by its alias', () => {
  const t = buildAliasTable([n('a', 'A')]);

  assert.equal(t.nodeAt('n1').title, 'A');
  assert.equal(t.nodeAt('n99'), null);
});

test('the path of a nested node names its ancestors', () => {
  const t = buildAliasTable([n('a', 'Здоровье', [n('a1', 'Бег', [n('a2', 'Кроссовки')])])]);

  assert.deepEqual(t.pathOf('n3'), ['Здоровье', 'Бег']);
  assert.deepEqual(t.pathOf('n1'), []);
});

test('depth and parent are recorded for rendering', () => {
  const t = buildAliasTable([n('a', 'A', [n('a1', 'A1')])]);

  assert.equal(t.all[1].depth, 1);
  assert.equal(t.all[1].parentAlias, 'n1');
  assert.equal(t.all[0].parentAlias, null);
});

test('an unknown id has no alias', () => {
  const t = buildAliasTable([n('a', 'A')]);

  assert.equal(t.aliasOf('nope'), null);
});

test('an empty graph produces an empty table', () => {
  const t = buildAliasTable([]);

  assert.equal(t.size, 0);
  assert.deepEqual(t.all, []);
});
