// dao_api2/src/ai/graphWriteTools.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAliasTable } from './aliases.js';
import { createWriteTools, KIND_LIST } from './graphWriteTools.js';

const n = (id, title, extra = {}) => ({
  id, title, nodeType: 'dao', nodeSubtype: 'simple',
  description: '', children: [], linkedNodeIds: {}, ...extra,
});

const graph = [
  n('health', 'Здоровье', {
    nodeType: 'fundamental', nodeSubtype: 'category',
    children: [n('run', 'Бегать')],
  }),
  n('offer', 'Получить оффер'),
];

const make = (edges = []) => createWriteTools(graph, buildAliasTable(graph), edges);

// Здоровье → Получить оффер, stored the way the server stores it: as an edge.
const connected = [{ id: 'e1', source: 'health', target: 'offer' }];

test('add stages a node with the kind the agent named', () => {
  const { tools, staged } = make();

  const said = tools.add({
    alias: 'docs', parent: '', title: 'Собрать документы',
    description: 'Петиция и паспорт.', kind: 'dao', x: 380, y: 0,
  });

  assert.equal(staged.length, 1);
  assert.equal(staged[0].op, 'add');
  assert.equal(staged[0].nodeType, 'dao');
  assert.equal(staged[0].nodeSubtype, 'simple');
  assert.equal(staged[0].parent, null, 'empty parent means top level');
  assert.match(said, /Собрать документы/);
});

test('add under a parent records the parent as a real id', () => {
  const { tools, staged } = make();

  tools.add({ alias: 'stretch', parent: 'n1', title: 'Растяжка', description: '', kind: 'dao', x: 0, y: 0 });

  assert.equal(staged[0].parent, 'health');
});

test('kata is no longer a kind the agent can use', () => {
  const { tools, staged } = make();

  const said = tools.add({ alias: 'water', parent: '', title: 'Пить воду', description: '', kind: 'kata-infinity', x: 0, y: 0 });

  assert.match(said, /not a kind I know/);
  assert.equal(staged.length, 0);
  assert.deepEqual(KIND_LIST, ['dao', 'ryu', 'kai', 'mi']);
});

test('an unknown kind is refused, not guessed at', () => {
  const { tools, staged } = make();

  const said = tools.add({ alias: 'x', parent: '', title: 'T', description: '', kind: 'sideways', x: 0, y: 0 });

  assert.equal(staged.length, 0);
  assert.match(said, /sideways/);
});

test('add under a parent that does not exist is refused', () => {
  const { tools, staged } = make();

  const said = tools.add({ alias: 'x', parent: 'n99', title: 'T', description: '', kind: 'dao', x: 0, y: 0 });

  assert.equal(staged.length, 0);
  assert.match(said, /n99/);
});

test('two nodes cannot claim the same alias', () => {
  const { tools, staged } = make();

  tools.add({ alias: 'x', parent: '', title: 'A', description: '', kind: 'dao', x: 0, y: 0 });
  const said = tools.add({ alias: 'x', parent: '', title: 'B', description: '', kind: 'dao', x: 0, y: 0 });

  assert.equal(staged.length, 1);
  assert.match(said, /x/);
});

test('update stages only the fields it was given', () => {
  const { tools, staged } = make();

  tools.update({ target: 'n3', description: 'Оффер с визовой поддержкой.' });

  assert.deepEqual(staged[0], { op: 'update', target: 'offer', description: 'Оффер с визовой поддержкой.' });
});

test('update that names no field is refused', () => {
  const { tools, staged } = make();

  const said = tools.update({ target: 'n3' });

  assert.equal(staged.length, 0);
  assert.match(said, /\p{L}/u);
});

test('update no longer sets a repetition target — only a Kata had one', () => {
  const { tools, staged } = make();

  const said = tools.update({ target: 'n3', requiredCompletions: 12 });

  assert.equal(staged.length, 0);
  assert.match(said, /changes nothing/);
});

test('update can change a kind', () => {
  const { tools, staged } = make();

  tools.update({ target: 'n3', kind: 'kai' });

  assert.equal(staged[0].nodeType, 'fundamental');
  assert.equal(staged[0].nodeSubtype, 'downstream');
});

test('remove stages a leaf', () => {
  const { tools, staged } = make();

  tools.remove({ target: 'n3' });

  assert.deepEqual(staged[0], { op: 'delete', target: 'offer' });
});

test('remove refuses a node with children and says why', () => {
  const { tools, staged } = make();

  const said = tools.remove({ target: 'n1' });

  assert.equal(staged.length, 0);
  assert.match(said, /Здоровье/);
  assert.match(said, /\p{L}/u);
});

test('link stages a connection between two existing nodes', () => {
  const { tools, staged } = make();

  tools.link({ source: 'n1', target: 'n3' });

  assert.deepEqual(staged[0], { op: 'link', source: 'health', target: 'offer' });
});

test('link can reach a node staged earlier in the same turn', () => {
  const { tools, staged } = make();

  tools.add({ alias: 'docs', parent: '', title: 'Документы', description: '', kind: 'dao', x: 0, y: 0 });
  tools.link({ source: 'n3', target: 'docs' });

  assert.equal(staged[1].target, 'docs', 'a node with no id yet keeps its alias');
});

test('a node cannot be linked to itself', () => {
  const { tools, staged } = make();

  const said = tools.link({ source: 'n3', target: 'n3' });

  assert.equal(staged.length, 0);
  assert.match(said, /\p{L}/u);
});

test('unlink stages the reverse', () => {
  const { tools, staged } = make(connected);

  tools.unlink({ source: 'n1', target: 'n3' });

  assert.equal(staged[0].op, 'unlink');
});

test('an operation aimed at an unknown alias is refused', () => {
  const { tools, staged } = make();

  const said = tools.update({ target: 'n99', title: 'x' });

  assert.equal(staged.length, 0);
  assert.match(said, /n99/);
});

// Fix 1: Type guards on input fields
test('add with non-string title does not throw and returns a refusal', () => {
  const { tools, staged } = make();

  const said = tools.add({ alias: 'x', parent: '', title: 42, description: '', kind: 'dao', x: 0, y: 0 });

  assert.equal(staged.length, 0, 'nothing staged');
  assert.match(said, /string/i, 'refusal mentions the type issue');
  assert.equal(typeof said, 'string', 'returns a string, does not throw');
});

test('add with non-string alias does not throw and returns a refusal', () => {
  const { tools, staged } = make();

  const said = tools.add({ alias: 123, parent: '', title: 'T', description: '', kind: 'dao', x: 0, y: 0 });

  assert.equal(staged.length, 0);
  assert.match(said, /alias/i);
});

test('add with non-string parent does not throw and returns a refusal', () => {
  const { tools, staged } = make();

  const said = tools.add({ alias: 'x', parent: 123, title: 'T', description: '', kind: 'dao', x: 0, y: 0 });

  assert.equal(staged.length, 0);
  assert.match(said, /parent/i);
});

test('add with non-string kind does not throw and returns a refusal', () => {
  const { tools, staged } = make();

  const said = tools.add({ alias: 'x', parent: '', title: 'T', description: '', kind: 42, x: 0, y: 0 });

  assert.equal(staged.length, 0);
  assert.match(said, /kind/i);
});

test('update with non-string target does not throw and returns a refusal', () => {
  const { tools, staged } = make();

  const said = tools.update({ target: 123, title: 'T' });

  assert.equal(staged.length, 0);
  assert.match(said, /target/i);
});

test('remove with non-string target does not throw and returns a refusal', () => {
  const { tools, staged } = make();

  const said = tools.remove({ target: 123 });

  assert.equal(staged.length, 0);
  assert.match(said, /target/i);
});

test('link with non-string source does not throw and returns a refusal', () => {
  const { tools, staged } = make();

  const said = tools.link({ source: 123, target: 'n3' });

  assert.equal(staged.length, 0);
  assert.match(said, /source/i);
});

test('link with non-string target does not throw and returns a refusal', () => {
  const { tools, staged } = make();

  const said = tools.link({ source: 'n1', target: 123 });

  assert.equal(staged.length, 0);
  assert.match(said, /target/i);
});

test('unlink with non-string source does not throw and returns a refusal', () => {
  const { tools, staged } = make();

  const said = tools.unlink({ source: 123, target: 'n3' });

  assert.equal(staged.length, 0);
  assert.match(said, /source/i);
});

test('unlink with non-string target does not throw and returns a refusal', () => {
  const { tools, staged } = make();

  const said = tools.unlink({ source: 'n1', target: 123 });

  assert.equal(staged.length, 0);
  assert.match(said, /target/i);
});

// Fix 2: Delete protection for nodes with children staged in the same turn
test('remove refuses a node with children staged in the same turn', () => {
  const { tools, staged } = make();

  tools.add({ alias: 'cat', parent: '', title: 'Category', description: '', kind: 'ryu', x: 0, y: 0 });
  const said = tools.add({ alias: 'child', parent: 'cat', title: 'Child', description: '', kind: 'dao', x: 0, y: 0 });

  // First add succeeds, second add should succeed too (it records parent as 'cat' alias)
  assert.equal(staged.length, 2, 'both adds staged');
  assert.match(said, /child/i);

  // Now try to remove the parent
  const removeSaid = tools.remove({ target: 'cat' });

  assert.equal(staged.length, 2, 'remove is refused, not staged');
  assert.match(removeSaid, /cat/i, 'names the node being removed');
  assert.match(removeSaid, /child/i, 'mentions the child');
});

// Fix 2b: Order-independence — nothing already staged for deletion may be referenced
test('add with parent that is already staged for deletion is refused', () => {
  const { tools, staged } = make();

  tools.remove({ target: 'n3' });
  const said = tools.add({ alias: 'child', parent: 'n3', title: 'Child', description: '', kind: 'dao', x: 0, y: 0 });

  assert.equal(staged.length, 1, 'only the delete is staged');
  assert.match(said, /n3/i, 'names the node that is already staged for deletion');
  assert.match(said, /already staged for deletion/i, 'explains the reason');
});

test('update that targets a node already staged for deletion is refused', () => {
  const { tools, staged } = make();

  tools.remove({ target: 'n3' });
  const said = tools.update({ target: 'n3', title: 'New' });

  assert.equal(staged.length, 1, 'only the delete is staged');
  assert.match(said, /n3/i, 'names the target');
  assert.match(said, /already staged for deletion/i);
});

test('link with source already staged for deletion is refused', () => {
  const { tools, staged } = make();

  tools.remove({ target: 'n3' });
  const said = tools.link({ source: 'n3', target: 'n1' });

  assert.equal(staged.length, 1, 'only the delete is staged');
  assert.match(said, /n3/i);
  assert.match(said, /already staged for deletion/i);
});

test('link with target already staged for deletion is refused', () => {
  const { tools, staged } = make();

  tools.remove({ target: 'n3' });
  const said = tools.link({ source: 'n1', target: 'n3' });

  assert.equal(staged.length, 1, 'only the delete is staged');
  assert.match(said, /n3/i);
  assert.match(said, /already staged for deletion/i);
});

test('unlink with source already staged for deletion is refused', () => {
  const { tools, staged } = make();

  tools.remove({ target: 'n3' });
  const said = tools.unlink({ source: 'n3', target: 'n1' });

  assert.equal(staged.length, 1, 'only the delete is staged');
  assert.match(said, /n3/i);
  assert.match(said, /already staged for deletion/i);
});

test('unlink with target already staged for deletion is refused', () => {
  const { tools, staged } = make();

  tools.remove({ target: 'n3' });
  const said = tools.unlink({ source: 'n1', target: 'n3' });

  assert.equal(staged.length, 1, 'only the delete is staged');
  assert.match(said, /n3/i);
  assert.match(said, /already staged for deletion/i);
});

// Fix 2c: Removing a node added in this same turn is refused
test('remove of a node added in this same turn is refused', () => {
  const { tools, staged } = make();

  tools.add({ alias: 'newnode', parent: '', title: 'New', description: '', kind: 'dao', x: 0, y: 0 });
  const said = tools.remove({ target: 'newnode' });

  assert.equal(staged.length, 1, 'only the add is staged');
  assert.match(said, /newnode/i, 'names the node');
  assert.match(said, /does not exist yet/i, 'explains it is not real');
});

// --- A link that already exists is not staged again ---

test('link refuses a connection that already exists', () => {
  const { tools, staged } = make(connected);

  const said = tools.link({ source: 'n1', target: 'n3' });

  assert.equal(staged.length, 0);
  assert.match(said, /already connected/i);
});

test('link sees an existing connection through linkedNodeIds too', () => {
  const nodes = [
    n('a', 'A', { linkedNodeIds: { downstream: ['b'] } }),
    n('b', 'B', { linkedNodeIds: { upstream: ['a'] } }),
  ];
  const { tools, staged } = createWriteTools(nodes, buildAliasTable(nodes));

  const said = tools.link({ source: 'n1', target: 'n2' });

  assert.equal(staged.length, 0);
  assert.match(said, /already connected/i);
});

test('link refuses the same connection staged twice in one turn', () => {
  const { tools, staged } = make();

  tools.link({ source: 'n1', target: 'n3' });
  const said = tools.link({ source: 'n1', target: 'n3' });

  assert.equal(staged.length, 1);
  assert.match(said, /already/i);
});

test('unlink refuses two nodes that are not connected', () => {
  const { tools, staged } = make();

  const said = tools.unlink({ source: 'n1', target: 'n3' });

  assert.equal(staged.length, 0);
  assert.match(said, /not connected/i);
});

test('a connection unlinked earlier in the turn can be linked again', () => {
  const { tools, staged } = make(connected);

  tools.unlink({ source: 'n1', target: 'n3' });
  tools.link({ source: 'n1', target: 'n3' });

  assert.deepEqual(staged.map((o) => o.op), ['unlink', 'link']);
});

// --- plan_path ---

const step = (id, title, after = []) => ({ id, title, description: '', after, checklist: [], repeat: 0 });
const move = {
  section: '', sectionTitle: 'Переезд', sectionDescription: '',
  stages: [
    { id: 'visa', title: 'Виза получена', description: '', after: [], steps: [step('find', 'Найти работодателя'), step('apply', 'Подать на визу', ['find'])] },
    { id: 'there', title: 'На месте', description: '', after: ['visa'], steps: [step('tickets', 'Купить билеты')] },
  ],
};

test('a plan stages its compiled operations, each marked as part of a plan', () => {
  const { tools, staged } = make();

  const said = tools.plan(move);

  assert.match(said, /^Staged:/);
  assert.ok(staged.length > 0);
  assert.ok(staged.every((o) => o.plan === true));
  assert.ok(staged.some((o) => o.op === 'add' && o.nodeSubtype === 'upstream'));
  assert.match(said, /Найти работодателя/, 'it says what can start now');
});

test('a refused plan stages nothing and passes on why', () => {
  const { tools, staged } = make();

  const said = tools.plan({ ...move, stages: [{ ...move.stages[1], after: ['ghost'] }] });

  assert.equal(staged.length, 0);
  assert.match(said, /no stage called ghost/);
});

test('a second plan in the same turn replaces the first — one plan is ever staged', () => {
  const { tools, staged } = make();

  // A model that tries plan_path out with a throwaway plan first must not be
  // stuck with it: the person would be shown the throwaway.
  tools.plan({ section: '', sectionTitle: 'test', sectionDescription: '', stages: [
    { id: 'probe', title: 'Test stage', description: '', after: [], steps: [{ id: 's', title: 'Test step', description: '', after: [], checklist: [] }] },
  ] });
  const said = tools.plan(move);

  assert.match(said, /^Staged:/);
  assert.match(said, /replaces the plan staged earlier/);
  assert.ok(staged.every((o) => o.plan === true));
  assert.ok(!staged.some((o) => /test/i.test(o.title || '')), 'nothing of the first plan is left');
  assert.equal(staged.filter((o) => o.op === 'add' && o.alias === 'plan:section').length, 1);
});

test('a refused second plan leaves the first one staged', () => {
  const { tools, staged } = make();

  tools.plan(move);
  const before = [...staged];
  const said = tools.plan({ ...move, stages: [{ ...move.stages[1], after: ['ghost'] }] });

  assert.match(said, /no stage called ghost/);
  assert.deepEqual(staged, before);
});

test('a plan other changes already point at is not replaced', () => {
  const { tools, staged } = make();

  tools.plan(move);
  tools.link({ source: 'n3', target: 'plan:visa:find' });
  const before = staged.length;
  const said = tools.plan(move);

  assert.equal(staged.length, before);
  assert.match(said, /already staged/);
});

test('a node of a staged plan can be pointed at later in the same turn', () => {
  const { tools } = make();

  tools.plan(move);

  assert.match(tools.link({ source: 'n3', target: 'plan:visa:find' }), /^Staged:/);
});

test('a plan into an existing ryu goes inside it', () => {
  const { tools, staged } = make();

  tools.plan({ ...move, section: 'n1' });

  assert.ok(staged.filter((o) => o.op === 'add' && !o.alias.split(':')[3]).every((o) => o.parent === 'health'));
});

test('a plan refuses when one of its aliases was already minted earlier in the turn', () => {
  const { tools, staged } = make();

  tools.add({ alias: 'plan:visa', parent: '', title: 'Заранее', description: '', kind: 'dao', x: 0, y: 0 });
  const said = tools.plan(move);

  assert.equal(staged.length, 1, 'nothing from the plan is staged');
  assert.match(said, /plan:visa/);
});

test('a section given as a pair of quotes means a new section — a model copies the "" it was shown', () => {
  for (const section of ['""', '"" ', '""\n', "''"]) {
    const { tools, staged } = make();
    const said = tools.plan({ ...move, section });
    assert.match(said, /^Staged:/, JSON.stringify(section));
    assert.ok(staged.some((o) => o.alias === 'plan:section'), 'a new section is made');
  }
});

test('a plan cannot go inside a section added in the same turn, and is told what to do instead', () => {
  const { tools } = make();

  tools.add({ alias: 'remont', parent: '', title: 'Ремонт', description: '', kind: 'ryu', x: 0, y: 0 });
  const said = tools.plan({ ...move, section: 'remont' });

  assert.match(said, /same turn/);
  assert.match(said, /sectionTitle/);
});

// --- markDone: the person says they did something, and the task is ticked. ---

const day = [
  n('home', 'Дом', {
    nodeType: 'fundamental', nodeSubtype: 'category',
    children: [
      n('milk', 'Купить молоко'),
      n('gym', 'Тренировка', { isDone: true }),
      n('docs', 'Собрать документы', {
        children: [n('passport', 'Паспорт'), n('photo', 'Фото', { isDone: true })],
      }),
    ],
  }),
  n('track', 'Карьера', { nodeType: 'fundamental', nodeSubtype: 'downstream' }),
  n('stage', 'Оффер получен', { nodeType: 'fundamental', nodeSubtype: 'upstream' }),
];
const onDay = () => createWriteTools(day, buildAliasTable(day));

test('markDone stages a tick on a task, by its real id', () => {
  const { tools, staged } = onDay();

  const said = tools.markDone({ target: 'n2', done: true });

  assert.deepEqual(staged, [{ op: 'done', target: 'milk', isDone: true }]);
  assert.match(said, /^Staged:.*Купить молоко/);
});

test('markDone with done: false stages taking a tick back', () => {
  const { tools, staged } = onDay();

  const said = tools.markDone({ target: 'n3', done: false });

  assert.deepEqual(staged, [{ op: 'done', target: 'gym', isDone: false }]);
  assert.match(said, /^Staged:.*Тренировка/);
});

test('markDone refuses a task already in that state', () => {
  const { tools, staged } = onDay();

  assert.doesNotMatch(tools.markDone({ target: 'n3', done: true }), /^Staged:/);
  assert.doesNotMatch(tools.markDone({ target: 'n2', done: false }), /^Staged:/);
  assert.equal(staged.length, 0);
});

test('markDone refuses the same task twice in one turn', () => {
  const { tools, staged } = onDay();

  tools.markDone({ target: 'n2', done: true });
  const again = tools.markDone({ target: 'n2', done: true });

  assert.doesNotMatch(again, /^Staged:/);
  assert.equal(staged.length, 1);
});

test('markDone refuses a group, a track and a milestone: their progress comes from tasks', () => {
  const { tools, staged } = onDay();

  for (const alias of ['n1', 'n7', 'n8']) {
    const said = tools.markDone({ target: alias, done: true });
    assert.doesNotMatch(said, /^Staged:/, alias);
    assert.match(said, /task/, alias);
  }
  assert.equal(staged.length, 0);
});

test('markDone on a task with items inside names the items still to tick', () => {
  const { tools, staged } = onDay();

  const said = tools.markDone({ target: 'n4', done: true });

  assert.doesNotMatch(said, /^Staged:/);
  assert.match(said, /n5 "Паспорт"/);
  assert.equal(said.includes('Фото'), false, 'an item already done is not offered again');
  assert.equal(staged.length, 0);
});

test('markDone refuses a node added in the same turn and an alias never handed out', () => {
  const { tools, staged } = onDay();

  tools.add({ alias: 'bread', parent: '', title: 'Хлеб', description: '', kind: 'dao', x: 0, y: 0 });
  assert.doesNotMatch(tools.markDone({ target: 'bread', done: true }), /^Staged:/);
  assert.doesNotMatch(tools.markDone({ target: 'n99', done: true }), /^Staged:/);
  assert.equal(staged.length, 1, 'only the add');
});

test('markDone asks for a yes or no rather than guessing one', () => {
  const { tools, staged } = onDay();

  assert.doesNotMatch(tools.markDone({ target: 'n2', done: 'yes' }), /^Staged:/);
  assert.equal(staged.length, 0);
});
