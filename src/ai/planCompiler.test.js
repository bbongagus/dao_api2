import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAliasTable } from './aliases.js';
import { compilePlan, COLUMN, ROW } from './planCompiler.js';

const step = (id, title, extra = {}) => ({ id, title, description: '', after: [], checklist: [], repeat: 0, ...extra });
const stage = (id, title, steps, after = []) => ({ id, title, description: '', after, steps });
const inNewSection = (stages) => ({ section: '', sectionTitle: 'Гражданство', sectionDescription: '', stages });

const citizenship = inNewSection([
  stage('origin', 'Происхождение подтверждено', [
    step('docs', 'Собрать документы'),
    step('agency', 'Подать в Агентство', { after: ['docs'] }),
  ]),
  stage('papers', 'Справка готова', [
    step('record', 'Справка о несудимости'),
    step('apostille', 'Апостиль', { after: ['record'] }),
  ]),
  stage('apply', 'Заявление рассмотрено', [
    step('submit', 'Подать заявление'),
    step('interview', 'Собеседование', { after: ['submit'] }),
  ], ['origin', 'papers']),
  stage('final', 'Гражданство получено', [step('decree', 'Дождаться указа')], ['apply']),
]);

const node = (id, title, extra = {}) => ({
  id, title, nodeType: 'dao', nodeSubtype: 'simple', description: '',
  position: { x: 0, y: 0 }, children: [], linkedNodeIds: {}, ...extra,
});
const graphOf = (nodes = []) => ({ nodes, aliases: buildAliasTable(nodes) });
const compile = (plan, graph = graphOf()) => compilePlan(plan, graph);
const adds = (r) => r.operations.filter((o) => o.op === 'add');
const add = (r, alias) => r.operations.find((o) => o.op === 'add' && o.alias === alias);
const linked = (r, source, target) => r.operations.some((o) => o.op === 'link' && o.source === source && o.target === target);

// --- nodes

test('a new section is a ryu at the top level, and holds the plan', () => {
  const r = compile(citizenship);
  const section = add(r, 'plan:section');

  assert.equal(section.parent, null);
  assert.equal(section.nodeType, 'fundamental');
  assert.equal(section.nodeSubtype, 'category');
  assert.equal(section.title, 'Гражданство');
  assert.equal(add(r, 'plan:origin:docs').parent, 'plan:section');
  assert.equal(add(r, 'plan:origin').parent, 'plan:section');
});

test('a step is a task and a stage is a Mi named for its outcome', () => {
  const r = compile(citizenship);

  assert.equal(add(r, 'plan:origin:docs').nodeType, 'dao');
  assert.equal(add(r, 'plan:origin:docs').nodeSubtype, 'simple');
  assert.equal(add(r, 'plan:origin').nodeType, 'fundamental');
  assert.equal(add(r, 'plan:origin').nodeSubtype, 'upstream');
  assert.equal(add(r, 'plan:origin').title, 'Происхождение подтверждено');
});

test('a step with a checklist holds its items inside', () => {
  const r = compile(inNewSection([
    stage('s', 'Готово', [step('pack', 'Собрать документы', { checklist: ['Паспорт', 'Свидетельство'] })]),
  ]));

  assert.equal(add(r, 'plan:s:pack').nodeSubtype, 'withChildren');
  assert.equal(add(r, 'plan:s:pack:1').parent, 'plan:s:pack');
  assert.equal(add(r, 'plan:s:pack:2').title, 'Свидетельство');
});

test('a step done several times is one task; the count goes in its description', () => {
  const r = compile(inNewSection([
    stage('s', 'Форма', [step('run', 'Пробежка', { repeat: 12 })]),
  ]));

  assert.equal(add(r, 'plan:s:run').nodeType, 'dao');
  assert.equal(add(r, 'plan:s:run').nodeSubtype, 'simple');
  assert.equal(add(r, 'plan:s:run').requiredCompletions, undefined);
});

// --- arrows

test('steps of a stage are chained, and its last step closes into its Mi', () => {
  const r = compile(citizenship);

  assert.ok(linked(r, 'plan:origin:docs', 'plan:origin:agency'));
  assert.ok(linked(r, 'plan:origin:agency', 'plan:origin'));
  assert.equal(linked(r, 'plan:origin:docs', 'plan:origin'), false, 'only the last step closes the stage');
});

test('a stage that waits for two hangs its first step off both Mi', () => {
  const r = compile(citizenship);

  assert.ok(linked(r, 'plan:origin', 'plan:apply:submit'));
  assert.ok(linked(r, 'plan:papers', 'plan:apply:submit'));
  assert.ok(linked(r, 'plan:apply', 'plan:final:decree'));
});

test('an implied prerequisite is not drawn', () => {
  const r = compile(inNewSection([
    stage('a', 'A', [step('x', 'X')]),
    stage('b', 'B', [step('y', 'Y')], ['a']),
    stage('c', 'C', [step('z', 'Z')], ['a', 'b']),
  ]));

  assert.ok(linked(r, 'plan:b', 'plan:c:z'));
  assert.equal(linked(r, 'plan:a', 'plan:c:z'), false);
});

test('each Mi, walking left the way progress does, reaches exactly its own stage', () => {
  const r = compile(citizenship);
  const byAlias = new Map(adds(r).map((o) => [o.alias, o]));
  const upstream = new Map();
  for (const o of r.operations.filter((x) => x.op === 'link')) {
    if (!upstream.has(o.target)) upstream.set(o.target, []);
    upstream.get(o.target).push(o.source);
  }
  const isMi = (alias) => byAlias.get(alias)?.nodeSubtype === 'upstream';
  const walk = (alias, seen = new Set()) => {
    for (const up of upstream.get(alias) || []) {
      if (seen.has(up) || isMi(up)) continue; // a previous Mi stops the walk and is not counted
      seen.add(up);
      walk(up, seen);
    }
    return seen;
  };

  for (const s of citizenship.stages) {
    const expected = s.steps.map((st) => `plan:${s.id}:${st.id}`).sort();
    assert.deepEqual([...walk(`plan:${s.id}`)].sort(), expected, s.id);
  }
});

test('only steps with nothing before them can start now', () => {
  assert.deepEqual(compile(citizenship).startNow, ['Собрать документы', 'Справка о несудимости']);
});

// --- layout

test('columns follow prerequisites, and a Mi sits right of its last step', () => {
  const r = compile(citizenship);
  const x = (alias) => add(r, alias).x;

  assert.equal(x('plan:origin:docs'), 0);
  assert.equal(x('plan:origin:agency'), COLUMN);
  assert.equal(x('plan:origin'), 2 * COLUMN);
  assert.equal(x('plan:apply:submit'), 3 * COLUMN);
  assert.equal(x('plan:apply'), 5 * COLUMN);
  assert.equal(x('plan:final:decree'), 6 * COLUMN);
});

test('parallel steps of a stage stack in rows', () => {
  const r = compile(inNewSection([
    stage('s', 'Готово', [step('a', 'A'), step('b', 'B')]),
  ]));

  assert.equal(add(r, 'plan:s:a').x, add(r, 'plan:s:b').x);
  assert.equal(Math.abs(add(r, 'plan:s:a').y - add(r, 'plan:s:b').y), ROW);
});

test('nothing inside the section overlaps', () => {
  const inside = adds(compile(citizenship)).filter((o) => o.parent === 'plan:section');

  for (const a of inside) {
    for (const b of inside) {
      if (a === b) continue;
      assert.ok(Math.abs(a.x - b.x) >= 180 || Math.abs(a.y - b.y) >= 60, `${a.title} overlaps ${b.title}`);
    }
  }
});

test('into an existing section, the plan goes below what is already there', () => {
  const graph = graphOf([node('sec', 'Гражданство', {
    nodeType: 'fundamental', nodeSubtype: 'category',
    children: [node('old', 'Старая задача', { position: { x: 0, y: 300 } })],
  })]);
  const r = compile({ section: 'n1', sectionTitle: '', sectionDescription: '', stages: citizenship.stages }, graph);

  assert.equal(add(r, 'plan:section'), undefined);
  assert.equal(add(r, 'plan:origin:docs').parent, 'sec');
  assert.equal(add(r, 'plan:origin:docs').y, 300 + 2 * ROW);
});

test('a new section goes below the lowest top-level node', () => {
  const r = compile(citizenship, graphOf([node('top', 'Музыка', { position: { x: 0, y: 480 } })]));

  assert.equal(add(r, 'plan:section').y, 480 + 2 * ROW);
});

// --- refusals

const refused = (plan, graph) => {
  const r = compile(plan, graph);
  assert.equal(r.operations, undefined, 'a refusal stages nothing');
  return r.error;
};

test('a section that is not a ryu is refused', () => {
  assert.match(refused({ ...citizenship, section: 'n1' }, graphOf([node('t', 'Задача')])), /not a ryu/);
});

test('a section alias that names nothing is refused', () => {
  assert.match(refused({ ...citizenship, section: 'n9' }), /no node called n9/);
});

test('a plan with no section and no title is refused', () => {
  assert.match(refused({ ...citizenship, sectionTitle: '' }), /Say where the plan goes/);
});

test('a step waiting on a step of another stage is refused, with the way out', () => {
  const error = refused(inNewSection([
    stage('origin', 'Происхождение', [step('cert', 'Удостоверение')]),
    stage('visa', 'Виза', [step('apply', 'Подать на визу', { after: ['cert'] })]),
  ]));

  assert.match(error, /stage origin/);
  assert.match(error, /split/);
});

test('a stage waiting on a stage that does not exist is refused', () => {
  assert.match(refused(inNewSection([stage('a', 'A', [step('x', 'X')], ['ghost'])])), /no stage called ghost/);
});

test('stages waiting for each other in a circle are refused', () => {
  assert.match(refused(inNewSection([
    stage('a', 'A', [step('x', 'X')], ['b']),
    stage('b', 'B', [step('y', 'Y')], ['a']),
  ])), /circle/);
});

test('steps waiting for each other in a circle are refused', () => {
  assert.match(refused(inNewSection([
    stage('a', 'A', [step('x', 'X', { after: ['y'] }), step('y', 'Y', { after: ['x'] })]),
  ])), /circle/);
});

test('a stage with no steps is refused', () => {
  assert.match(refused(inNewSection([stage('a', 'A', [])])), /no steps/);
});

test('two stages with one id are refused', () => {
  assert.match(refused(inNewSection([stage('a', 'A', [step('x', 'X')]), stage('a', 'B', [step('y', 'Y')])])), /unique/);
});

test('a stage id containing a colon is refused', () => {
  assert.match(refused(inNewSection([stage('a:b', 'A', [step('c', 'C')])])), /cannot contain ':'/);
});

test('a step id containing a colon is refused', () => {
  assert.match(refused(inNewSection([stage('a', 'A', [step('b:c', 'C')])])), /cannot contain ':'/);
});

test('a stage id of "section" is refused, since that alias is reserved for the section itself', () => {
  assert.match(refused(inNewSection([stage('section', 'A', [step('x', 'X')])])), /reserved/);
});

test('a plan of any size is compiled — there is no node limit', () => {
  const steps = Array.from({ length: 60 }, (_, i) => step(`s${i}`, `Шаг ${i}`));
  const result = compilePlan({ section: '', sectionTitle: 'Большой', stages: [stage('big', 'Большой', steps)] }, { nodes: [], aliases: buildAliasTable([]) });
  assert.equal(result.error, undefined);
});

// --- forks: alternatives, of which the person takes exactly one.
// A fork is one task; every arrow leaving it is an option. What only the
// options not taken lead to is folded away by the app (forks.js).

const option = (stage, label = '', hint = '') => ({ stage, label, hint });
const fork = (id, title, after, options, description = '') => ({ id, title, description, after, options });

// Паспорт переведён ─ [Что у вас есть?] ─ родство ─┐
//                                       ├ брак ────┼─ Заявление подано
//                                       └──────────┘   (ничего: сразу к заявлению)
const residence = {
  section: '', sectionTitle: 'Вид на жительство', sectionDescription: '',
  stages: [
    stage('prep', 'Паспорт переведён', [step('passport', 'Перевести загранпаспорт')]),
    stage('kin', 'Родство подтверждено', [
      step('birth', 'Запросить свидетельство о рождении'),
      step('proof', 'Заверить перевод', { after: ['birth'] }),
    ]),
    stage('marriage', 'Брак подтверждён', [step('cert', 'Апостилировать свидетельство о браке')]),
    stage('apply', 'Заявление подано', [
      step('form', 'Заполнить заявление'),
      step('submit', 'Подать заявление', { after: ['form'] }),
    ], ['kin', 'marriage']),
  ],
  forks: [fork('basis', 'Что у вас есть, кроме загранпаспорта?', ['prep'], [
    option('kin', 'Родственник-гражданин', 'Нужны документы о родстве'),
    option('marriage', 'Брак с гражданином', 'Нужно свидетельство о браке'),
    option('apply', 'Ничего из этого', 'Сразу к заявлению'),
  ], 'От основания зависит, какие документы собирать.')],
};
const changed = (mutate, plan = residence) => { const copy = structuredClone(plan); mutate(copy); return copy; };
const arrows = (r) => r.operations.filter((o) => o.op === 'link').map((o) => `${o.source} → ${o.target}`);
const into = (r, alias) => r.operations.filter((o) => o.op === 'link' && o.target === alias).map((o) => o.source);
const outOf = (r, alias) => r.operations.filter((o) => o.op === 'link' && o.source === alias).map((o) => o.target);

test('a fork is one task on the level of the plan, naming each option by the first step it leads to', () => {
  const r = compile(residence);

  assert.deepEqual(add(r, 'plan:basis'), {
    op: 'add', alias: 'plan:basis', parent: 'plan:section',
    title: 'Что у вас есть, кроме загранпаспорта?',
    description: 'От основания зависит, какие документы собирать.',
    nodeType: 'dao', nodeSubtype: 'simple',
    x: 2 * COLUMN, y: ROW, downstream: [],
    fork: true,
    forkOptions: [
      { target: 'plan:kin:birth', label: 'Родственник-гражданин', hint: 'Нужны документы о родстве' },
      { target: 'plan:marriage:cert', label: 'Брак с гражданином', hint: 'Нужно свидетельство о браке' },
      { target: 'plan:apply:form', label: 'Ничего из этого', hint: 'Сразу к заявлению' },
    ],
  });
});

test('nothing but the fork carries the fork fields', () => {
  for (const o of adds(compile(residence))) {
    if (o.alias === 'plan:basis') continue;
    assert.equal('fork' in o, false, o.alias);
    assert.equal('forkOptions' in o, false, o.alias);
  }
});

test('a fork waits for the Milestones in its after, and every arrow leaving it is an option', () => {
  const r = compile(residence);

  assert.deepEqual(into(r, 'plan:basis'), ['plan:prep']);
  assert.deepEqual(outOf(r, 'plan:basis'), ['plan:kin:birth', 'plan:marriage:cert', 'plan:apply:form']);
});

test('the stage where the options meet waits for the last stage of each, as without a fork', () => {
  const r = compile(residence);

  // Two paths end in a Milestone; the third is the fork's own arrow.
  assert.deepEqual(into(r, 'plan:apply:form'), ['plan:kin', 'plan:marriage', 'plan:basis']);
});

test('a plan with a three-option fork, node by node and arrow by arrow', () => {
  const r = compile(residence);

  assert.deepEqual(adds(r).map((o) => o.alias), [
    'plan:section',
    'plan:prep:passport', 'plan:prep',
    'plan:basis',
    'plan:kin:birth', 'plan:kin:proof', 'plan:kin',
    'plan:marriage:cert', 'plan:marriage',
    'plan:apply:form', 'plan:apply:submit', 'plan:apply',
  ]);
  assert.deepEqual(arrows(r), [
    'plan:prep:passport → plan:prep',
    'plan:prep → plan:basis',
    'plan:basis → plan:kin:birth',
    'plan:kin:birth → plan:kin:proof',
    'plan:kin:proof → plan:kin',
    'plan:basis → plan:marriage:cert',
    'plan:marriage:cert → plan:marriage',
    'plan:kin → plan:apply:form',
    'plan:marriage → plan:apply:form',
    'plan:basis → plan:apply:form',
    'plan:apply:form → plan:apply:submit',
    'plan:apply:submit → plan:apply',
  ]);
  assert.deepEqual(r.stats, { stages: 4, nodes: 12, links: 12, forks: 1 });
});

test('a plan without forks reports none', () => {
  assert.equal(compile(citizenship).stats.forks, 0);
});

test('the first step of an option cannot start now: it waits for the choice', () => {
  assert.deepEqual(compile(residence).startNow, ['Перевести загранпаспорт']);
});

test('a fork the plan starts with is what can start now, and nothing leads to it', () => {
  const r = compile(changed((p) => { p.stages.shift(); p.forks[0].after = []; }));

  assert.deepEqual(r.startNow, ['Что у вас есть, кроме загранпаспорта?']);
  assert.deepEqual(into(r, 'plan:basis'), []);
  assert.equal(add(r, 'plan:basis').x, 0);
  assert.equal(add(r, 'plan:kin:birth').x, COLUMN);
});

test('a fork sits one column right of the Milestones it waits for, and its options start right of it', () => {
  const r = compile(residence);
  const x = (alias) => add(r, alias).x;

  assert.equal(x('plan:prep'), COLUMN);
  assert.equal(x('plan:basis'), 2 * COLUMN);
  assert.equal(x('plan:kin:birth'), 3 * COLUMN);
  assert.equal(x('plan:marriage:cert'), 3 * COLUMN);
  assert.equal(x('plan:kin'), 5 * COLUMN);
  assert.equal(x('plan:apply:form'), 6 * COLUMN, 'right of the furthest Milestone it waits for');
});

test('nothing overlaps in a plan with a fork', () => {
  const inside = adds(compile(residence)).filter((o) => o.parent === 'plan:section');

  assert.equal(inside.length, 11);
  for (const a of inside) {
    for (const b of inside) {
      if (a === b) continue;
      assert.ok(Math.abs(a.x - b.x) >= 180 || Math.abs(a.y - b.y) >= 60, `${a.title} overlaps ${b.title}`);
    }
  }
});

test('a prerequisite the fork already waits for is not drawn again into its option', () => {
  const r = compile(changed((p) => { p.stages[1].after = ['prep']; }));

  assert.deepEqual(into(r, 'plan:kin:birth'), ['plan:basis']);
});

test('an option keeps a prerequisite of its own beside the fork, and then cannot start now either', () => {
  const r = compile(changed((p) => {
    p.stages.push(stage('photo', 'Фото готово', [step('shoot', 'Сфотографироваться')]));
    p.stages[2].after = ['photo'];
  }));

  assert.deepEqual(into(r, 'plan:marriage:cert'), ['plan:photo', 'plan:basis']);
  assert.deepEqual(r.startNow, ['Перевести загранпаспорт', 'Сфотографироваться']);
});

test('a stage that names its own fork in after says nothing the option did not', () => {
  const r = compile(changed((p) => { p.stages[1].after = ['basis']; }));

  assert.equal(r.error, undefined);
  assert.deepEqual(into(r, 'plan:kin:birth'), ['plan:basis']);
  assert.equal(arrows(r).length, 12);
});

test('a fork that waits for two stages drops the arrow one of them implies', () => {
  const r = compile(changed((p) => {
    p.stages.splice(1, 0, stage('fee', 'Пошлина оплачена', [step('pay', 'Оплатить пошлину')], ['prep']));
    p.forks[0].after = ['prep', 'fee'];
  }));

  assert.deepEqual(into(r, 'plan:basis'), ['plan:fee']);
  assert.equal(add(r, 'plan:basis').x, 4 * COLUMN);
});

test('each Milestone after a fork, walking left, counts its own steps and the choice that led to them', () => {
  const r = compile(residence);
  const byAlias = new Map(adds(r).map((o) => [o.alias, o]));
  const isMi = (alias) => byAlias.get(alias)?.nodeSubtype === 'upstream';
  const walk = (alias, seen = new Set()) => {
    for (const up of into(r, alias)) {
      if (seen.has(up) || isMi(up)) continue; // a previous Milestone stops the walk and is not counted
      seen.add(up);
      walk(up, seen);
    }
    return [...seen].sort();
  };

  assert.deepEqual(walk('plan:prep'), ['plan:prep:passport']);
  assert.deepEqual(walk('plan:kin'), ['plan:basis', 'plan:kin:birth', 'plan:kin:proof']);
  assert.deepEqual(walk('plan:marriage'), ['plan:basis', 'plan:marriage:cert']);
  assert.deepEqual(walk('plan:apply'), ['plan:apply:form', 'plan:apply:submit', 'plan:basis']);
});

test('two forks in a row: the second waits for the stage where the first one\'s options met', () => {
  const r = compile(changed((p) => {
    p.stages.push(
      stage('post', 'Отправлено почтой', [step('mail', 'Отправить письмом')]),
      stage('visit', 'Подано лично', [step('queue', 'Записаться на приём')]),
      stage('done', 'Решение получено', [step('wait', 'Дождаться решения')], ['post', 'visit']),
    );
    p.forks.push(fork('how', 'Как подаёте?', ['apply'], [option('post', 'Почтой'), option('visit', 'Лично')]));
  }));

  assert.equal(r.error, undefined);
  assert.deepEqual(into(r, 'plan:how'), ['plan:apply']);
  assert.deepEqual(outOf(r, 'plan:how'), ['plan:post:mail', 'plan:visit:queue']);
  assert.deepEqual(into(r, 'plan:done:wait'), ['plan:post', 'plan:visit']);
  assert.deepEqual(add(r, 'plan:how').forkOptions, [
    { target: 'plan:post:mail', label: 'Почтой', hint: '' },
    { target: 'plan:visit:queue', label: 'Лично', hint: '' },
  ]);
  assert.equal(r.stats.forks, 2);
});

test('a fork inside a path of another fork waits for that path, and the paths of both meet at the end', () => {
  const one = (id, title) => stage(id, title, [step('x', `${title}: шаг`)]);
  const r = compile({
    section: '', sectionTitle: 'Вложенный выбор', sectionDescription: '',
    stages: [
      one('start', 'Начало'), one('a', 'А'), one('b', 'Б'), one('c', 'В'), one('d', 'Г'),
      stage('end', 'Конец', [step('x', 'Конец: шаг')], ['b', 'c', 'd']),
    ],
    forks: [
      fork('f1', 'А или Б?', ['start'], [option('a'), option('b')]),
      fork('f2', 'В или Г?', ['a'], [option('c'), option('d')]),
    ],
  });

  assert.equal(r.error, undefined);
  assert.deepEqual(into(r, 'plan:f2'), ['plan:a']);
  assert.deepEqual(outOf(r, 'plan:f2'), ['plan:c:x', 'plan:d:x']);
  assert.deepEqual(into(r, 'plan:end:x'), ['plan:b', 'plan:c', 'plan:d']);
  assert.equal(add(r, 'plan:f1').x, 2 * COLUMN);
  assert.equal(add(r, 'plan:f2').x, 5 * COLUMN);
  assert.equal(add(r, 'plan:end:x').x, 8 * COLUMN);
  assert.deepEqual(r.startNow, ['Начало: шаг']);
});

test('the order the stages are given in changes the rows, not the arrows or the columns', () => {
  const r = compile(changed((p) => { p.stages.reverse(); }));
  const inside = adds(r).filter((o) => o.parent === 'plan:section');

  assert.deepEqual(new Set(arrows(r)), new Set([
    'plan:prep:passport → plan:prep',
    'plan:prep → plan:basis',
    'plan:basis → plan:kin:birth',
    'plan:kin:birth → plan:kin:proof',
    'plan:kin:proof → plan:kin',
    'plan:basis → plan:marriage:cert',
    'plan:marriage:cert → plan:marriage',
    'plan:kin → plan:apply:form',
    'plan:marriage → plan:apply:form',
    'plan:basis → plan:apply:form',
    'plan:apply:form → plan:apply:submit',
    'plan:apply:submit → plan:apply',
  ]));
  assert.equal(arrows(r).length, 12);
  assert.equal(add(r, 'plan:basis').x, 2 * COLUMN);
  assert.equal(add(r, 'plan:apply:form').x, 6 * COLUMN);
  assert.deepEqual(r.startNow, ['Перевести загранпаспорт']);
  for (const a of inside) {
    for (const b of inside) {
      if (a === b) continue;
      assert.ok(Math.abs(a.x - b.x) >= 180 || Math.abs(a.y - b.y) >= 60, `${a.title} overlaps ${b.title}`);
    }
  }
});

test('into an existing section, a fork goes inside it with the rest of the plan', () => {
  const graph = graphOf([node('sec', 'Переезд', {
    nodeType: 'fundamental', nodeSubtype: 'category',
    children: [node('old', 'Старая задача', { position: { x: 0, y: 300 } })],
  })]);
  const r = compile({ ...residence, section: 'n1', sectionTitle: '' }, graph);

  assert.equal(add(r, 'plan:section'), undefined);
  assert.equal(add(r, 'plan:basis').parent, 'sec');
  assert.equal(add(r, 'plan:basis').y, 300 + 3 * ROW, 'below what is there, on the row of its first option');
});

test('an option can start with a step that has a checklist', () => {
  const r = compile(changed((p) => { p.stages[2].steps[0].checklist = ['Оригинал', 'Перевод']; }));

  assert.equal(add(r, 'plan:marriage:cert').nodeSubtype, 'withChildren');
  assert.equal(add(r, 'plan:basis').forkOptions[1].target, 'plan:marriage:cert');
  assert.deepEqual(into(r, 'plan:marriage:cert:1'), [], 'no arrow touches a checklist item');
});

// --- forks: refusals

test('a fork with fewer than two options is refused', () => {
  assert.match(refused(changed((p) => { p.forks[0].options.length = 1; })), /fewer than two options/);
  assert.match(refused(changed((p) => { p.forks[0].options = []; })), /fewer than two options/);
});

test('an option naming a stage that does not exist is refused', () => {
  assert.match(refused(changed((p) => { p.forks[0].options[0].stage = 'ghost'; })), /no stage called ghost/);
  assert.match(refused(changed((p) => { p.forks[0].options[0].stage = ''; })), /needs a stage/);
});

test('two options of one fork naming the same stage are refused', () => {
  assert.match(refused(changed((p) => { p.forks[0].options[1].stage = 'kin'; })), /Two options of fork basis start with stage kin/);
});

test('a stage named by options of two forks is refused', () => {
  const error = refused(changed((p) => {
    p.stages.push(stage('other', 'Другое', [step('x', 'X')]));
    p.forks.push(fork('second', 'Ещё выбор', ['prep'], [option('kin'), option('other')]));
  }));

  assert.match(error, /Stage kin is an option of both fork basis and fork second/);
});

test('a fork id that is also a stage id, or section, or holds a colon, is refused', () => {
  assert.match(refused(changed((p) => { p.forks[0].id = 'kin'; })), /kin is the id of both a stage and a fork/);
  assert.match(refused(changed((p) => { p.forks[0].id = 'section'; })), /reserved/);
  assert.match(refused(changed((p) => { p.forks[0].id = 'a:b'; })), /Fork id a:b cannot contain ':'/);
  assert.match(refused(changed((p) => { p.forks[0].id = ''; })), /Every fork needs an id/);
});

test('two forks with one id are refused', () => {
  assert.match(refused(changed((p) => { p.forks.push(structuredClone(p.forks[0])); })), /Two forks are called basis/);
});

test('a fork with no title is refused', () => {
  assert.match(refused(changed((p) => { p.forks[0].title = ' '; })), /Fork basis needs a title/);
});

test('a fork waiting for a stage that does not exist, or for another fork, is refused', () => {
  assert.match(refused(changed((p) => { p.forks[0].after = ['ghost']; })), /Fork basis comes after ghost, but there is no stage called ghost/);

  const error = refused(changed((p) => {
    p.stages.push(stage('post', 'Почтой', [step('mail', 'Письмо')]), stage('visit', 'Лично', [step('queue', 'Очередь')]));
    p.forks.push(fork('how', 'Как подаёте?', ['basis'], [option('post'), option('visit')]));
  }));
  assert.match(error, /Fork how comes after basis, which is a fork/);
});

test('a stage waiting for a fork that does not offer it is refused, with the way to say it', () => {
  const error = refused(changed((p) => {
    p.stages.push(stage('extra', 'Доп. этап', [step('x', 'X')], ['basis']));
  }));

  assert.match(error, /Stage extra comes after basis, which is a fork/);
  assert.match(error, /last stage of every option/);
});

test('a fork waiting for a stage behind its own options is refused as a circle', () => {
  assert.match(refused(changed((p) => { p.forks[0].after = ['apply']; })), /circle/);
});

test('two forks waiting on each other in a circle are refused', () => {
  const error = refused({
    section: '', sectionTitle: 'Круг', sectionDescription: '',
    stages: [
      stage('a1', 'A1', [step('x', 'X')]), stage('a2', 'A2', [step('x', 'X')]),
      stage('b1', 'B1', [step('x', 'X')]), stage('b2', 'B2', [step('x', 'X')]),
    ],
    forks: [
      fork('fa', 'A?', ['b1'], [option('a1'), option('a2')]),
      fork('fb', 'B?', ['a1'], [option('b1'), option('b2')]),
    ],
  });

  assert.match(error, /forks and stages wait for each other in a circle/);
});

test('sequence: true with a fork is refused: a chain of stages contradicts alternatives', () => {
  const error = refused({ ...residence, sequence: true });

  assert.match(error, /sequence: false/);
  assert.match(error, /after/);
  assert.equal(compile({ ...residence, sequence: false }).error, undefined);
  assert.equal(compile({ ...citizenship, sequence: true, forks: [] }).error, undefined, 'no fork, no objection');
});

test('an option whose stage has several first steps is refused: a fork leads to one step per option', () => {
  const error = refused(changed((p) => { p.stages[1].steps[1].after = []; }));

  assert.match(error, /Stage kin starts an option of fork basis, but has 2 first steps \(birth, proof\)/);
  assert.match(error, /single first step/);
});

test('the same holds for the stage an empty-handed option goes straight to', () => {
  const error = refused(changed((p) => { p.stages[3].steps[1].after = []; }));

  assert.match(error, /Stage apply starts an option of fork basis, but has 2 first steps \(form, submit\)/);
});
