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
  n('vision', 'Видение', {
    nodeType: 'fundamental', nodeSubtype: 'upstream',
    linkedNodeIds: { upstream: ['visa'] },
  }),
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

test('inspect renders upstream links on mi nodes', () => {
  const out = tools().inspect({ alias: 'n6', depth: 1 });

  assert.match(out, /n4 → n6/, 'upstream link shown as sources → alias');
});

test('overview shows upstream links on mi nodes', () => {
  const out = tools().overview();

  assert.match(out, /n4 → n6/, 'upstream link appears in overview too');
});

test('inspect caps children per level and explains the cut', () => {
  const manyChildren = [
    n('parent', 'Родитель', {
      nodeType: 'fundamental', nodeSubtype: 'category',
      children: Array.from({ length: 50 }, (_, i) =>
        n(`child${i}`, `Дитя ${i}`, { description: `Описание ${i}` })
      ),
    }),
  ];
  const out = createReadTools(manyChildren, buildAliasTable(manyChildren)).inspect({
    alias: 'n1',
    depth: 2,
  });

  assert.match(out, /… 10 more below/, 'explains how many children were omitted (50 - 40 = 10)');
});

test('search truncates at 25 and explains how many were cut', () => {
  const manyMatches = Array.from({ length: 30 }, (_, i) =>
    n(`node${i}`, `Поиск ${i}`, { description: `Результат ${i}` })
  );
  const out = createReadTools(manyMatches, buildAliasTable(manyMatches)).search({
    text: 'Поиск',
  });

  assert.match(out, /5 more/, 'tells the model 5 more matched (30 - 25 = 5)');
});

test('inspect never shows a uuid', () => {
  const out = tools().inspect({ alias: 'n1', depth: 2 });

  assert.equal(out.includes('health'), false, 'health uuid should not appear');
  assert.equal(out.includes('run'), false, 'run uuid should not appear');
  assert.equal(out.includes('shoes'), false, 'shoes uuid should not appear');
});

test('search never shows a uuid', () => {
  const out = tools().search({ text: 'кроссовки' });

  assert.equal(out.includes('shoes'), false, 'shoes uuid should not appear');
  assert.equal(out.includes('health'), false, 'health uuid should not appear');
});

// --- Links live in graph.edges. On the server linkedNodeIds is usually empty,
// so a reader that only looks there sees a graph with no links at all. ---

const staged = [
  n('stage', 'Этап', { nodeType: 'fundamental', nodeSubtype: 'downstream' }),
  n('task', 'Задача'),
];
const lineOf = (out, alias) => out.split('\n').find((l) => l.startsWith(`${alias} `));
const readWithEdges = (edges, nodes = staged) => createReadTools(nodes, buildAliasTable(nodes), edges);

test('links are read from the graph edges when linkedNodeIds is empty', () => {
  const out = readWithEdges([{ id: 'e1', source: 'stage', target: 'task' }]).overview();

  assert.equal(lineOf(out, 'n1'), 'n1 [kai] Этап · n1 → n2');
  assert.equal(lineOf(out, 'n2'), 'n2 [dao] Задача · n1 → n2');
});

test('a link stored twice, or in both edges and linkedNodeIds, is shown once', () => {
  const nodes = [{ ...staged[0], linkedNodeIds: { downstream: ['task'] } }, staged[1]];
  const out = readWithEdges([
    { id: 'e1', source: 'stage', target: 'task' },
    { id: 'e2', source: 'stage', target: 'task' },
  ], nodes).overview();

  assert.equal(lineOf(out, 'n1'), 'n1 [kai] Этап · n1 → n2');
});

test('an edge marked upstream reads from its target to its source', () => {
  const out = readWithEdges([{ id: 'e1', source: 'task', target: 'stage', direction: 'upstream' }]).overview();

  assert.equal(lineOf(out, 'n1'), 'n1 [kai] Этап · n1 → n2');
});

test('a neutral edge is not a link', () => {
  const out = readWithEdges([{ id: 'e1', source: 'stage', target: 'task', direction: 'neutral' }]).overview();

  assert.equal(lineOf(out, 'n1'), 'n1 [kai] Этап');
});
