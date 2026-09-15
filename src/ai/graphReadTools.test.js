import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAliasTable } from './aliases.js';
import { createReadTools } from './graphReadTools.js';

const n = (id, title, extra = {}) => ({
  id, title, nodeType: 'dao', nodeSubtype: 'simple',
  description: '', children: [], linkedNodeIds: {}, ...extra,
});

const graph = [
  n('health', 'Здоровье', {
    nodeType: 'fundamental', nodeSubtype: 'category',
    description: 'Всё про форму и самочувствие.',
    children: [
      n('run', 'Бегать по утрам', { nodeType: 'repeatable', nodeSubtype: 'infinity' }),
      n('shoes', 'Купить кроссовки', { isDone: true, description: 'Под свою постановку стопы.' }),
    ],
  }),
  n('visa', 'Виза', {
    nodeType: 'fundamental', nodeSubtype: 'downstream',
    linkedNodeIds: { downstream: ['offer'] },
  }),
  n('offer', 'Получить оффер'),
];

const tools = () => createReadTools(graph, buildAliasTable(graph));

test('overview lists the top level only, with child counts', () => {
  const out = tools().overview();

  assert.match(out, /n1 \[ryu\] Здоровье/);
  assert.match(out, /2 inside/);
  assert.match(out, /Виза/);
  assert.equal(out.includes('Купить кроссовки'), false, 'children are not in the overview');
});

test('overview never shows a uuid', () => {
  const out = tools().overview();

  assert.equal(out.includes('health'), false);
});

test('inspect returns a subtree with descriptions', () => {
  const out = tools().inspect({ alias: 'n1', depth: 2 });

  assert.match(out, /Здоровье/);
  assert.match(out, /Бегать по утрам/);
  assert.match(out, /Под свою постановку стопы/);
});

test('inspect marks what is already done', () => {
  const out = tools().inspect({ alias: 'n1', depth: 2 });

  assert.match(out, /Купить кроссовки.*done/);
});

test('inspect shows links by alias', () => {
  const out = tools().inspect({ alias: 'n4', depth: 1 });

  assert.match(out, /n4 → n5/);
});

test('inspect of an unknown alias explains itself instead of throwing', () => {
  const out = tools().inspect({ alias: 'n99', depth: 1 });

  assert.match(out, /n99/);
  assert.match(out, /\p{L}/u);
});

test('search finds a node anywhere in the tree', () => {
  const out = tools().search({ text: 'кроссовки' });

  assert.match(out, /n3/);
  assert.match(out, /Купить кроссовки/);
});

test('search shows where a nested result lives', () => {
  const out = tools().search({ text: 'кроссовки' });

  assert.match(out, /Здоровье/, 'the path tells the model where it is');
});

test('search matches descriptions too, and ignores case', () => {
  const out = tools().search({ text: 'ПОСТАНОВКУ' });

  assert.match(out, /Купить кроссовки/);
});

test('search that finds nothing says so', () => {
  const out = tools().search({ text: 'ничегонет' });

  assert.match(out, /\p{L}/u);
  assert.equal(out.includes('n1'), false);
});

test('an empty graph still answers overview', () => {
  const empty = createReadTools([], buildAliasTable([]));

  assert.match(empty.overview(), /\p{L}/u);
});
