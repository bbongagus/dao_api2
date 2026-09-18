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

test('a plan over forty nodes is refused', () => {
  const steps = Array.from({ length: 40 }, (_, i) => step(`s${i}`, `Шаг ${i}`));
  assert.match(refused(inNewSection([stage('big', 'Большой', steps)])), /more than 40/);
});
