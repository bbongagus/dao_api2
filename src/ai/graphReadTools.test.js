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

test('inspect can actually read the siblings omitted from its first page', () => {
  const nodes = [n('area', 'Area', { children: Array.from({ length: 85 }, (_, i) => n(`id${i}`, `Task ${i}`)) })];
  const read = createReadTools(nodes, buildAliasTable(nodes));
  assert.match(read.inspect({ alias: 'n1' }), /offset 40/);
  const second = read.inspect({ alias: 'n1', offset: 40 });
  assert.match(second, /Task 40/);
  assert.doesNotMatch(second, /Task 39/);
  assert.match(second, /offset 80/);
  const last = read.inspect({ alias: 'n1', offset: 80 });
  assert.match(last, /Task 84/);
  assert.doesNotMatch(last, /more below/);
});

test('inspect shows links by alias', () => {
  const out = tools().inspect({ alias: 'n4', depth: 1 });

  assert.match(out, /n4 → n5/);
});

test('opening a flat Track exposes its path and nested checklist items, but not unrelated work', () => {
  const nodes = [n('track', 'Track', { nodeType: 'fundamental', nodeSubtype: 'downstream' }),
    n('list', 'Comments', { children: [n('item', 'Comment 1', { isDone: true })] }),
    n('result', 'Outcome', { nodeType: 'fundamental', nodeSubtype: 'upstream' }), n('other', 'Unrelated')];
  const edges = [{ source: 'track', target: 'list' }, { source: 'list', target: 'result' }];
  const out = createReadTools(nodes, buildAliasTable(nodes), edges).inspect({ alias: 'n1', depth: 3 });
  assert.match(out, /Track path: 2 connected/);
  assert.match(out, /Comment 1.*done/);
  assert.match(out, /Outcome/);
  assert.doesNotMatch(out, /Unrelated/);
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

// Kata was switched off on 2026-09-18, and stored graphs may still hold one.
// The agent must not see a kind it cannot name, so it reads as a task.
test('a stored repeatable node reads as a dao in the overview', () => {
  for (const nodeSubtype of ['bounded', 'infinity']) {
    const nodes = [n('habit', 'Бегать по утрам', { nodeType: 'repeatable', nodeSubtype, requiredCompletions: 12 })];
    const out = createReadTools(nodes, buildAliasTable(nodes)).overview();

    assert.equal(lineOf(out, 'n1'), 'n1 [dao] Бегать по утрам');
    assert.equal(/repeatable|kata/i.test(out), false);
  }
});

// --- tasks: the whole list to match a dictated sentence against, by meaning.
// A person says "сходил в зал"; the title says "Тренировка". No word search
// finds that, so the model reads every candidate instead. ---

test('tasks lists the open tasks, with where each one sits', () => {
  const out = tools().tasks({ done: false });

  assert.equal(lineOf(out, 'n2'), 'n2 Бегать по утрам — in Здоровье');
  assert.equal(lineOf(out, 'n5'), 'n5 Получить оффер');
});

test('tasks leaves out groups, tracks, milestones and what is already done', () => {
  const out = tools().tasks({ done: false });

  for (const title of ['Здоровье', 'Виза', 'Видение']) {
    assert.equal(out.split('\n').some((l) => l.endsWith(`] ${title}`) || l.match(new RegExp(`^n\\d+ ${title}$`))), false, title);
  }
  assert.equal(out.includes('Купить кроссовки'), false);
});

test('tasks with done: true lists what is done, most recently done first', () => {
  const nodes = [
    n('a', 'Давно', { isDone: true, doneAt: '2026-09-01T10:00:00.000Z' }),
    n('b', 'Вчера', { isDone: true, doneAt: '2026-09-23T10:00:00.000Z' }),
    n('c', 'Когда-то', { isDone: true }),
    n('d', 'Не сделано'),
  ];
  const out = createReadTools(nodes, buildAliasTable(nodes)).tasks({ done: true });

  const titles = out.split('\n').filter((l) => /^n\d+ /.test(l)).map((l) => l.replace(/^n\d+ /, ''));
  assert.deepEqual(titles, ['Вчера', 'Давно', 'Когда-то']);
});

test('a task with items inside is listed through its items, which name it as their place', () => {
  const nodes = [
    n('docs', 'Собрать документы', {
      children: [n('passport', 'Паспорт'), n('photo', 'Фото', { isDone: true })],
    }),
  ];
  const out = createReadTools(nodes, buildAliasTable(nodes)).tasks({ done: false });

  assert.equal(lineOf(out, 'n1'), undefined, 'the checklist card itself is not a thing to tick');
  assert.equal(lineOf(out, 'n2'), 'n2 Паспорт — in Собрать документы');
  assert.equal(out.includes('Фото'), false);
});

test('tasks caps a very long list and says how to reach the rest', () => {
  const many = Array.from({ length: 310 }, (_, i) => n(`t${i}`, `Задача ${i}`));
  const out = createReadTools(many, buildAliasTable(many)).tasks({ done: false });

  assert.equal(out.split('\n').filter((l) => /^n\d+ /.test(l)).length, 300);
  assert.match(out, /10 more/);
  assert.match(out, /search/);
});

test('tasks with nothing to list says so in words', () => {
  const out = tools().tasks({ done: true });
  const none = createReadTools([], buildAliasTable([])).tasks({ done: false });

  assert.match(out, /Купить кроссовки/);
  assert.match(none, /\p{L}/u);
  assert.equal(/^n\d+ /m.test(none), false);
});

test('tasks never shows a uuid', () => {
  const out = tools().tasks({ done: false });

  assert.equal(out.includes('run'), false);
  assert.equal(out.includes('offer'), false);
});

// --- forks: a task whose arrows are alternatives. The person takes one, in
// the app; what only the others lead to is out of the plan. ---

// Inside the Group "Поездка":
//   Подготовка ─ Как едем? ─ Забронировать автобус ─ Собрать сумку ─┬─ Пересечь границу
//                         └ Купить билет на самолёт ────────────────┘
const trip = (fork = {}) => [n('trip', 'Поездка', {
  nodeType: 'fundamental', nodeSubtype: 'category',
  children: [
    n('pre', 'Подготовка', { isDone: true }),
    n('way', 'Как едем?', {
      fork: true, choice: null, forkOptions: [{ target: 'bus', label: 'По земле', hint: 'Два шага' }], ...fork,
    }),
    n('bus', 'Забронировать автобус'),
    n('bag', 'Собрать сумку'),
    n('fly', 'Купить билет на самолёт'),
    n('border', 'Пересечь границу'),
  ],
})];
const tripEdges = [
  { source: 'pre', target: 'way' },
  { source: 'way', target: 'bus' }, { source: 'bus', target: 'bag' }, { source: 'bag', target: 'border' },
  { source: 'way', target: 'fly' }, { source: 'fly', target: 'border' },
];
const readTrip = (fork) => { const nodes = trip(fork); return createReadTools(nodes, buildAliasTable(nodes), tripEdges); };
const nestedLineOf = (out, alias) => out.split('\n').find((l) => l.trimStart().startsWith(`${alias} `));

test('inspect shows a fork with each option by label and alias, and that none is chosen', () => {
  const out = readTrip().inspect({ alias: 'n1', depth: 2 });

  // The first option is named by the fork; the second by the step it leads to.
  assert.equal(
    nestedLineOf(out, 'n3'),
    '  n3 [dao] Как едем? · n3 → n4, n6 · n2 → n3 · fork, one of: "По земле" → n4; "Купить билет на самолёт" → n6 · not chosen yet',
  );
});

test('inspect shows which option of a fork is taken', () => {
  const out = readTrip({ choice: 'fly', isDone: true }).inspect({ alias: 'n1', depth: 2 });

  assert.equal(
    nestedLineOf(out, 'n3'),
    '  n3 [dao] Как едем? · n3 → n4, n6 · n2 → n3 · fork, one of: "По земле" → n4; "Купить билет на самолёт" → n6 · chosen: "Купить билет на самолёт" → n6 · done',
  );
});

// A fork is decided by the option on it, not by its tick: the two can part
// when the step chosen is deleted, and every reader goes by the choice.
test('a choice that is no longer one of the fork\'s arrows reads as none, whatever its tick says', () => {
  const read = readTrip({ choice: 'gone', isDone: true });

  assert.equal(
    read.inspect({ alias: 'n3', depth: 1 }),
    'n3 [dao] Как едем? · n3 → n4, n6 · n2 → n3 · fork, one of: "По земле" → n4; "Купить билет на самолёт" → n6 · not chosen yet',
  );
  assert.equal(nestedLineOf(read.tasks({ done: false }), 'n3'), 'n3 Как едем? — in Поездка');
  assert.equal(nestedLineOf(read.tasks({ done: true }), 'n3'), undefined);
});

test('a fork with an option taken reads as done even when its tick was lost', () => {
  const read = readTrip({ choice: 'fly', isDone: false });

  assert.match(read.inspect({ alias: 'n3', depth: 1 }), /chosen: "Купить билет на самолёт" → n6 · done$/);
  assert.equal(nestedLineOf(read.tasks({ done: true }), 'n3'), 'n3 Как едем? — in Поездка');
  assert.equal(nestedLineOf(read.tasks({ done: false }), 'n3'), undefined);
});

test('overview and search show a fork the same way', () => {
  const nodes = [
    n('way', 'Как едем?', { fork: true, choice: 'bus', isDone: true }),
    n('bus', 'Автобус'), n('fly', 'Самолёт'),
  ];
  const edges = [{ source: 'way', target: 'bus' }, { source: 'way', target: 'fly' }];
  const read = createReadTools(nodes, buildAliasTable(nodes), edges);
  const line = 'n1 [dao] Как едем? · n1 → n2, n3 · fork, one of: "Автобус" → n2; "Самолёт" → n3 · chosen: "Автобус" → n2 · done';

  assert.equal(lineOf(read.overview(), 'n1'), line);
  assert.equal(read.search({ text: 'едем' }), line);
});

test('option names that arrive malformed fall back to the steps, and never break the line', () => {
  const nodes = [
    n('way', 'Как едем?', {
      fork: true, choice: null,
      forkOptions: [null, 'junk', { target: 'bus', label: 5 }, { target: 7, label: 'x' }, { target: 'fly', label: { ru: 'Самолётом' } }],
    }),
    n('bus', 'Автобус'), n('fly', 'Самолёт'),
  ];
  const edges = [{ source: 'way', target: 'bus' }, { source: 'way', target: 'fly' }];
  const out = createReadTools(nodes, buildAliasTable(nodes), edges).overview();

  assert.equal(lineOf(out, 'n1'), 'n1 [dao] Как едем? · n1 → n2, n3 · fork, one of: "Автобус" → n2; "Самолёт" → n3 · not chosen yet');
});

test('a fork whose option names are not a list at all still reads', () => {
  const nodes = [n('way', 'Как едем?', { fork: true, choice: 'bus', forkOptions: 'none' }), n('bus', 'Автобус'), n('fly', 'Самолёт')];
  const edges = [{ source: 'way', target: 'bus' }, { source: 'way', target: 'fly' }];
  const out = createReadTools(nodes, buildAliasTable(nodes), edges).overview();

  assert.equal(lineOf(out, 'n1'), 'n1 [dao] Как едем? · n1 → n2, n3 · fork, one of: "Автобус" → n2; "Самолёт" → n3 · chosen: "Автобус" → n2 · done');
});

// The mark alone makes no fork: with nothing to choose between, the node is
// the task it otherwise is, on the screen and here.
test('a task marked as a fork with one way on, or none, reads as the task it is', () => {
  const nodes = [
    n('way', 'Как едем?', { fork: true, choice: null, forkOptions: [] }),
    n('bus', 'Автобус'),
    n('alone', 'Куда?', { fork: true, isDone: true }),
  ];
  const read = createReadTools(nodes, buildAliasTable(nodes), [{ source: 'way', target: 'bus' }]);

  assert.equal(lineOf(read.overview(), 'n1'), 'n1 [dao] Как едем? · n1 → n2');
  assert.equal(lineOf(read.overview(), 'n3'), 'n3 [dao] Куда? · done');
});

test('a marked task whose arrows lead into another level is a task: its tick is its own', () => {
  const nodes = [
    n('way', 'Как едем?', { fork: true, choice: 'bus', isDone: false }),
    n('ways', 'Способы', { nodeType: 'fundamental', nodeSubtype: 'category', children: [n('bus', 'Автобус'), n('fly', 'Самолёт')] }),
  ];
  const read = createReadTools(nodes, buildAliasTable(nodes), [{ source: 'way', target: 'bus' }, { source: 'way', target: 'fly' }]);

  assert.equal(lineOf(read.overview(), 'n1'), 'n1 [dao] Как едем? · n1 → n3, n4');
  assert.equal(read.tasks({ done: false }), [
    '3 task(s) still to do. Match what the person said by meaning, not by the words.',
    'n1 Как едем?',
    'n3 Автобус — in Способы',
    'n4 Самолёт — in Способы',
  ].join('\n'));
});

test('the steps around a fork read exactly as any other task', () => {
  const out = readTrip().inspect({ alias: 'n1', depth: 2 });

  assert.equal(nestedLineOf(out, 'n4'), '  n4 [dao] Забронировать автобус · n4 → n5 · n3 → n4');
  assert.equal(nestedLineOf(out, 'n7'), '  n7 [dao] Пересечь границу · n5, n6 → n7');
});

test('tasks leaves out the path a fork did not take', () => {
  const out = readTrip({ choice: 'fly', isDone: true }).tasks({ done: false });

  assert.equal(out, [
    '2 task(s) still to do. Match what the person said by meaning, not by the words.',
    'n6 Купить билет на самолёт — in Поездка',
    'n7 Пересечь границу — in Поездка',
  ].join('\n'));
});

test('tasks keeps every path of a fork nobody has chosen at, and the fork itself', () => {
  const out = readTrip().tasks({ done: false });

  assert.equal(out, [
    '5 task(s) still to do. Match what the person said by meaning, not by the words.',
    'n3 Как едем? — in Поездка',
    'n4 Забронировать автобус — in Поездка',
    'n5 Собрать сумку — in Поездка',
    'n6 Купить билет на самолёт — in Поездка',
    'n7 Пересечь границу — in Поездка',
  ].join('\n'));
});

test('tasks leaves out the items of a checklist on a path not taken', () => {
  const nodes = [
    n('way', 'Как едем?', { fork: true, choice: 'fly', isDone: true }),
    n('bag', 'Собрать сумку', { nodeSubtype: 'withChildren', children: [n('socks', 'Носки'), n('charger', 'Зарядка')] }),
    n('fly', 'Купить билет'),
  ];
  const edges = [{ source: 'way', target: 'bag' }, { source: 'way', target: 'fly' }];
  const out = createReadTools(nodes, buildAliasTable(nodes), edges).tasks({ done: false });

  assert.equal(out, [
    '1 task(s) still to do. Match what the person said by meaning, not by the words.',
    'n5 Купить билет',
  ].join('\n'));
});

test('a tick on a path not taken is not listed among the done either', () => {
  const nodes = [
    n('way', 'Как едем?', { fork: true, choice: 'fly', isDone: true, doneAt: '2026-11-10T10:00:00.000Z' }),
    n('bus', 'Автобус', { isDone: true, doneAt: '2026-11-11T10:00:00.000Z' }),
    n('fly', 'Самолёт', { isDone: true, doneAt: '2026-11-12T10:00:00.000Z' }),
  ];
  const edges = [{ source: 'way', target: 'bus' }, { source: 'way', target: 'fly' }];
  const out = createReadTools(nodes, buildAliasTable(nodes), edges).tasks({ done: true });

  assert.equal(out, [
    '2 task(s) done. Match what the person said by meaning, not by the words.',
    'n3 Самолёт',
    'n1 Как едем?',
  ].join('\n'));
});

test('when only a path not taken is left open, nothing is still to do', () => {
  const nodes = [
    n('way', 'Как едем?', { fork: true, choice: 'fly', isDone: true }),
    n('bus', 'Автобус'),
    n('fly', 'Самолёт', { isDone: true }),
  ];
  const edges = [{ source: 'way', target: 'bus' }, { source: 'way', target: 'fly' }];

  assert.equal(
    createReadTools(nodes, buildAliasTable(nodes), edges).tasks({ done: false }),
    'Every task is done; none is still to do.',
  );
});
