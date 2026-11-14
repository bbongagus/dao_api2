import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAliasTable } from './aliases.js';
import { compilePlan } from './planCompiler.js';
import { projectDraft } from './graphDraft.js';
import { createWriteTools } from './graphWriteTools.js';
import { trackReworkFixture } from './fixtures/trackRework.js';

export function checkTrack(draft, original) {
  const area = draft.aliases.nodeAt(original.aliases.aliasOf('area'));
  assert.equal(area.nodeSubtype, 'category');
  const track = area.children.find(n => n.nodeSubtype === 'downstream');
  assert.equal(track.nodeSubtype,'downstream'); assert.equal(track.children.length,0);
  const all = draft.aliases.all.map(e=>e.node);
  assert.equal(all.filter(n=>n.nodeType==='fundamental'&&n.nodeSubtype==='category').length,1);
  const milestones=all.filter(n=>n.nodeSubtype==='upstream'); assert.equal(milestones.length,4);
  const children = all.filter(n=>n.nodeType==='dao'&&n.children.length);
  assert.equal(children.length,4); assert.ok(children.every(n=>n.children.length===7));
  for(const {node} of original.aliases.all) {
    if(['area','week1','week2','week3','week4'].includes(node.id)) continue;
    const kept=all.find(n=>n.id===node.id); assert.ok(kept,node.title);
    assert.equal(kept.isDone,node.isDone); assert.equal(kept.doneAt,node.doneAt);
  }
  const reachable=new Set();
  const visit=id=>{if(reachable.has(id))return; reachable.add(id); draft.edges.filter(e=>e.source===id).forEach(e=>visit(e.target));}; visit(track.id);
  for(const n of area.children) assert.ok(reachable.has(n.id),`unreachable ${n.title}`);
  for(const parent of children) for(const child of parent.children) assert.ok(!draft.edges.some(e=>e.source===child.id||e.target===child.id));
  assert.ok(draft.edges.some(e=>e.source==='profile'&&e.target==='topic1'));
  assert.ok(draft.edges.some(e=>e.source==='plan:s2'&&e.target==='topic4'));
  assert.ok(draft.edges.some(e=>e.source==='plan:s3'&&e.target==='topic7'));
  for(let i=1;i<=4;i++) assert.ok(draft.edges.some(e=>e.source===`comments${i}`&&e.target===(i===1?'profile':`plan:s${i}`)));
}

test('one plan call flattens weeks into a connected Track with real checklists and preserved completions',()=>{
  const fixture=trackReworkFixture(), before=structuredClone(fixture.nodes);
  const {tools,staged}=createWriteTools(fixture.nodes,fixture.aliases,fixture.edges,{canMove:true});
  assert.match(tools.plan(fixture.plan),/^Staged:/);
  checkTrack(projectDraft(fixture.nodes,fixture.edges,staged,fixture.aliases),fixture);
  assert.deepEqual(fixture.nodes,before);
  assert.ok(staged.filter(o=>o.op==='delete').every(o=>/^week/.test(o.target)));
});

test('refused replacement is atomic; valid replacement does not duplicate moves or checklists',()=>{
  const f=trackReworkFixture(), {tools,staged}=createWriteTools(f.nodes,f.aliases,f.edges,{canMove:true});
  tools.plan(f.plan); const before=structuredClone(staged);
  const bad=structuredClone(f.plan); bad.stages[1].steps.at(-1).checklist.pop();
  assert.match(tools.plan(bad),/7 checklist items/); assert.deepEqual(staged,before);
  assert.match(tools.plan(f.plan),/^Staged:/); assert.deepEqual(staged,before);
});

test('Track refuses omitted work, duplicate references, disconnected stages and external links',()=>{
  for(const modify of [
    p=>p.stages[1].steps.shift(),
    p=>p.stages[1].steps.push(structuredClone(p.stages[1].steps[0])),
    p=>{p.sequence=false;},
  ]) { const f=trackReworkFixture(); modify(f.plan); assert.ok(compilePlan(f.plan,f).error); }
  const f=trackReworkFixture(); f.edges.push({source:'unrelated',target:'headline'});
  assert.match(compilePlan(f.plan,f).error,/outside/);
});

test('new Track has one root and stage outcomes on the same level',()=>{
  const f=trackReworkFixture();
  const p={layout:'track',sequence:true,section:'',sectionTitle:'New goal',stages:[
    {id:'a',title:'First outcome',steps:[{id:'work',title:'Work',checklist:[]}]},
    {id:'b',title:'Final outcome',steps:[{id:'calls',title:'2 calls',checklistCount:2,checklist:['Call 1','Call 2']}]},
  ]};
  const result=compilePlan(p,f); assert.equal(result.error,undefined);
  const track=result.operations.find(o=>o.alias==='plan:section'); assert.equal(track.nodeSubtype,'downstream');
  assert.equal(result.operations.find(o=>o.alias==='plan-container').parent,null);
  assert.ok(result.operations.filter(o=>o.op==='add'&&o.alias!=='plan-container'&&!/plan:b:calls:/.test(o.alias)).every(o=>o.parent==='plan-container'));
  assert.ok(result.operations.some(o=>o.op==='link'&&o.source==='plan:section'&&o.target==='plan:a:work'));
});

test('the checked Track contract rejects post-plan damage and completed tasks are not suggested again',()=>{
  const f=trackReworkFixture();
  const state=createWriteTools(f.nodes,f.aliases,f.edges,{canMove:true});
  const said=state.tools.plan(f.plan);
  assert.match(said,/Can start now: "7 комментариев"/);
  assert.doesNotMatch(said,/Can start now:.*Обновить/);
  assert.equal(state.validate(),null);
  state.tools.unlink({source:'plan:s2',target:f.aliases.aliasOf('topic4')});
  assert.match(state.validate(),/connections/);
});

test('completed wrappers and omitted existing children are refused',()=>{
  const f=trackReworkFixture(); f.nodes[0].children[0].isDone=true;
  assert.ok(compilePlan(f.plan,f).error);
  const c=trackReworkFixture();
  c.nodes[0].children.at(-1).children.at(-1).children.push({id:'forgotten',title:'Forgotten item',nodeType:'dao',nodeSubtype:'simple',children:[]});
  c.aliases=buildAliasTable(c.nodes);
  assert.match(compilePlan(c.plan,c).error,/Forgotten item.*missing/);
});

test('root Track gets one container; subsequent edits reuse it and preserve the Track id', () => {
  const plan = {layout:'track', sequence:true, section:'', sectionTitle:'Plan', stages:[
    {id:'a',title:'Outcome',steps:[{id:'work',title:'Work',checklist:[]}]}]};
  const base = {nodes:[],edges:[],aliases:buildAliasTable([])};
  const first = compilePlan(plan,base);
  const initial = projectDraft([],[],first.operations,base.aliases);
  const container = initial.nodes[0];
  // Reproduce the previously released root-level graph.
  const nodes = container.children;
  const aliases = buildAliasTable(nodes);
  const track = nodes.find(n=>n.nodeSubtype==='downstream');
  plan.section = aliases.aliasOf(track.id);
  plan.stages[0].existing = aliases.aliasOf('plan:a');
  plan.stages[0].steps[0].existing = aliases.aliasOf('plan:a:work');
  const compiled = compilePlan(plan,{nodes,aliases,edges:initial.edges});
  assert.equal(compiled.error,undefined);
  const wrapped = projectDraft(nodes,initial.edges,compiled.operations,aliases);
  assert.equal(wrapped.nodes.length,1);
  assert.equal(wrapped.nodes[0].nodeSubtype,'category');
  assert.ok(wrapped.nodes[0].children.some(n=>n.id===track.id));
  plan.section = wrapped.aliases.aliasOf(track.id);
  plan.stages[0].existing = wrapped.aliases.aliasOf('plan:a');
  plan.stages[0].steps[0].existing = wrapped.aliases.aliasOf('plan:a:work');
  const repeated = compilePlan(plan,wrapped);
  assert.equal(repeated.error,undefined);
  assert.ok(!repeated.operations.some(o=>o.op==='add'));
});


test('editing the enclosing Group again reuses its existing Track', () => {
  const f = trackReworkFixture();
  const d = projectDraft(f.nodes,f.edges,compilePlan(f.plan,f).operations,f.aliases);
  const plan = structuredClone(f.plan);
  plan.section = d.aliases.aliasOf('area');
  for(let i=0;i<plan.stages.length;i++) {
    const stage=plan.stages[i];
    stage.existing = d.aliases.aliasOf(i===0?'profile':`plan:s${i+1}`);
    for(const step of stage.steps) {
      const stepId = step.existing ? f.aliases.nodeAt(step.existing).id : `plan:${stage.id}:${step.id}`;
      step.existing = d.aliases.aliasOf(stepId);
      step.checklist = (step.checklist || []).map((item,j)=>({
        title: typeof item==='string' ? item : item.title,
        existing: d.aliases.aliasOf(item.existing ? f.aliases.nodeAt(item.existing).id : `plan:${stage.id}:${step.id}:${j+1}`),
      }));
    }
  }
  const compiled = compilePlan(plan,d);
  assert.equal(compiled.error,undefined);
  assert.ok(!compiled.operations.some(o=>o.op==='add'));
});

// --- forks in a Track: alternatives, of which the person takes exactly one

const s = (id, title, after = []) => ({ id, title, description: '', after, checklistCount: 0, checklist: [] });
const st = (id, title, steps, after = []) => ({ id, title, description: '', after, steps });
// Track ─ Перевести паспорт ─ Паспорт переведён ─ [Что у вас есть?] ─ родство ─┐
//                                                                   ├ брак ────┼─ Заявление подано
//                                                                   └──────────┘
const residence = () => ({
  layout: 'track', sequence: false, section: '', sectionTitle: 'Вид на жительство', sectionDescription: '',
  stages: [
    st('prep', 'Паспорт переведён', [s('passport', 'Перевести загранпаспорт')]),
    st('kin', 'Родство подтверждено', [s('birth', 'Запросить свидетельство о рождении'), s('proof', 'Заверить перевод', ['birth'])]),
    st('marriage', 'Брак подтверждён', [s('cert', 'Апостилировать свидетельство о браке')]),
    st('apply', 'Заявление подано', [s('form', 'Заполнить заявление'), s('submit', 'Подать заявление', ['form'])], ['kin', 'marriage']),
  ],
  forks: [{
    id: 'basis', title: 'Что у вас есть, кроме загранпаспорта?', description: '', after: ['prep'],
    options: [
      { stage: 'kin', label: 'Родственник-гражданин', hint: '' },
      { stage: 'marriage', label: 'Брак с гражданином', hint: '' },
      { stage: 'apply', label: 'Ничего из этого', hint: '' },
    ],
  }],
});
const empty = () => ({ nodes: [], edges: [], aliases: buildAliasTable([]) });
const arrowsOf = (r) => r.operations.filter((o) => o.op === 'link').map((o) => `${o.source} → ${o.target}`);

test('a Track plan with a fork: the fork sits beside the Track with the steps, and the Track starts the path', () => {
  const r = compilePlan(residence(), empty());

  assert.equal(r.error, undefined);
  assert.deepEqual(r.operations.filter((o) => o.op === 'add').map((o) => `${o.alias} in ${o.parent}`), [
    'plan-container in null',
    'plan:section in plan-container',
    'plan:prep:passport in plan-container', 'plan:prep in plan-container',
    'plan:basis in plan-container',
    'plan:kin:birth in plan-container', 'plan:kin:proof in plan-container', 'plan:kin in plan-container',
    'plan:marriage:cert in plan-container', 'plan:marriage in plan-container',
    'plan:apply:form in plan-container', 'plan:apply:submit in plan-container', 'plan:apply in plan-container',
  ]);
  const fork = r.operations.find((o) => o.alias === 'plan:basis');
  assert.equal(fork.fork, true);
  assert.equal(fork.nodeType, 'dao');
  assert.equal(fork.nodeSubtype, 'simple');
  assert.deepEqual(fork.forkOptions, [
    { target: 'plan:kin:birth', label: 'Родственник-гражданин', hint: '' },
    { target: 'plan:marriage:cert', label: 'Брак с гражданином', hint: '' },
    { target: 'plan:apply:form', label: 'Ничего из этого', hint: '' },
  ]);
  assert.deepEqual(arrowsOf(r), [
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
    'plan:section → plan:prep:passport',
  ]);
  assert.deepEqual(r.startNow, ['Перевести загранпаспорт']);
});

test('a Track that starts with a fork leads to the fork, and to none of its options', () => {
  const plan = residence();
  plan.stages.shift();
  plan.forks[0].after = [];
  const r = compilePlan(plan, empty());

  assert.equal(r.error, undefined);
  assert.deepEqual(arrowsOf(r).filter((a) => a.startsWith('plan:section →')), ['plan:section → plan:basis']);
  assert.deepEqual(r.startNow, ['Что у вас есть, кроме загранпаспорта?']);
});

test('the checked Track contract accepts a plan with a fork, and the draft shows it as one', () => {
  const { nodes, edges, aliases } = empty();
  const state = createWriteTools(nodes, aliases, edges, { canMove: true });

  assert.match(state.tools.plan(residence()), /^Staged:/);
  assert.equal(state.validate(), null);

  const draft = projectDraft(nodes, edges, state.staged, aliases);
  const fork = draft.aliases.nodeAt('plan:basis');
  assert.equal(fork.fork, true);
  assert.equal(fork.choice, null);
  assert.equal(draft.aliases.entryAt('plan:basis').parentAlias, 'plan-container');
});

test('a fork whose paths never meet again is refused: a Track needs one final outcome', () => {
  const plan = residence();
  plan.stages.pop();
  plan.forks[0].options.pop();
  const error = compilePlan(plan, empty()).error;

  assert.match(error, /one final outcome/);
  assert.match(error, /last stage of every option/);
  assert.doesNotMatch(error, /sequence: true/, 'a chain of stages is not a way out when there is a fork');
});

test('a Track plan without forks keeps the old sentence about its final outcome', () => {
  const plan = residence();
  delete plan.forks;
  plan.stages[3].after = ['kin'];

  assert.equal(
    compilePlan(plan, empty()).error,
    'A Track needs one final outcome. Connect the stage outcomes, or use sequence: true for the requested stage-by-stage path.',
  );
});

// The tool's schema lets only lists through, but the compiler is also called
// directly: what is not a list is read as nothing, as the stage compiler does.
test('a forks field, or a fork\'s after, that is not a list is read as empty in a Track, never thrown on', () => {
  const plain = residence();
  plain.forks = 'none';
  plain.stages[1].after = ['prep'];
  plain.stages[2].after = ['prep'];
  const without = compilePlan(plain, empty());

  assert.equal(without.error, undefined);
  assert.equal(without.stats.forks, 0);

  const loose = residence();
  loose.stages.shift();
  loose.forks[0].after = 'apply';
  const first = compilePlan(loose, empty());

  assert.equal(first.error, undefined);
  assert.deepEqual(first.startNow, ['Что у вас есть, кроме загранпаспорта?']);
});

test('sequence: true with a fork is refused in a Track too', () => {
  const error = compilePlan({ ...residence(), sequence: true }, empty()).error;

  assert.match(error, /sequence: false/);
});

// Переезд (Group): the birth certificate is already requested, and ticked.
const moving = () => {
  const nodes = [{
    id: 'area', title: 'Переезд', description: '', nodeType: 'fundamental', nodeSubtype: 'category', position: { x: 0, y: 0 },
    children: [{
      id: 'birth', title: 'Запросить свидетельство о рождении', description: '', nodeType: 'dao', nodeSubtype: 'simple',
      position: { x: 0, y: 0 }, children: [], isDone: true, doneAt: '2026-11-01T09:00:00Z',
    }],
  }];
  return { nodes, edges: [], aliases: buildAliasTable(nodes) };
};

test('an option that starts with an existing task names that task, by its id, and keeps its tick', () => {
  const graph = moving();
  const plan = {
    layout: 'track', sequence: false, section: 'n1', sectionTitle: '', sectionDescription: '',
    stages: [
      st('kin', 'Родство подтверждено', [{ ...s('birth', 'Запросить свидетельство о рождении'), existing: 'n2' }]),
      st('marriage', 'Брак подтверждён', [s('cert', 'Апостилировать свидетельство о браке')]),
      st('apply', 'Заявление подано', [s('form', 'Заполнить заявление')], ['kin', 'marriage']),
    ],
    forks: [{
      id: 'basis', title: 'Какое у вас основание?', description: '', after: [],
      options: [{ stage: 'kin', label: 'Родство', hint: '' }, { stage: 'marriage', label: 'Брак', hint: '' }],
    }],
  };
  const r = compilePlan(plan, graph);

  assert.equal(r.error, undefined);
  assert.deepEqual(r.operations.find((o) => o.alias === 'plan:basis').forkOptions, [
    { target: 'birth', label: 'Родство', hint: '' },
    { target: 'plan:marriage:cert', label: 'Брак', hint: '' },
  ]);
  assert.deepEqual(arrowsOf(r), [
    'plan:basis → birth',
    'birth → plan:kin',
    'plan:basis → plan:marriage:cert',
    'plan:marriage:cert → plan:marriage',
    'plan:kin → plan:apply:form',
    'plan:marriage → plan:apply:form',
    'plan:apply:form → plan:apply',
    'plan:section → plan:basis',
  ]);
  assert.equal(r.operations.some((o) => o.op === 'add' && (o.alias === 'birth' || o.alias === 'plan:kin:birth')), false);
  assert.deepEqual(r.startNow, ['Какое у вас основание?']);

  const state = createWriteTools(graph.nodes, graph.aliases, graph.edges, { canMove: true });
  assert.match(state.tools.plan(plan), /^Staged:/);
  assert.equal(state.validate(), null);
  const kept = projectDraft(graph.nodes, graph.edges, state.staged, graph.aliases).aliases.nodeAt('n2');
  assert.equal(kept.isDone, true);
  assert.equal(kept.doneAt, '2026-11-01T09:00:00Z');
});

// A restructure never rebuilds a path around a fork that already exists: as
// a plain step it would keep its mark, and the arrows the plan gives it
// would read as alternatives.
const crossroads = () => {
  const task = (id, title, extra = {}) => ({
    id, title, description: '', nodeType: 'dao', nodeSubtype: 'simple', position: { x: 0, y: 0 }, children: [], ...extra,
  });
  const nodes = [{
    ...task('area', 'Поездка'), nodeType: 'fundamental', nodeSubtype: 'category',
    children: [task('way', 'Как едем?', { fork: true, choice: null }), task('bus', 'Автобус'), task('fly', 'Самолёт')],
  }];
  const edges = [{ source: 'way', target: 'bus' }, { source: 'way', target: 'fly' }];
  return { nodes, edges, aliases: buildAliasTable(nodes) };
};
const trip = (steps) => ({
  layout: 'track', sequence: true, section: 'n1', sectionTitle: '', sectionDescription: '',
  stages: [st('go', 'Доехали', steps)],
});

test('an existing fork cannot be reused as a step of a new path', () => {
  const error = compilePlan(trip([
    { ...s('way', 'Как едем?'), existing: 'n2' },
    { ...s('bus', 'Автобус', ['way']), existing: 'n3' },
    { ...s('fly', 'Самолёт', ['way']), existing: 'n4' },
  ]), crossroads()).error;

  assert.match(error, /n2 is a fork/);
  assert.match(error, /move_node, link_nodes/);
});

test('an existing fork left out of a restructure is refused for being a fork, not for being forgotten', () => {
  const error = compilePlan(trip([
    { ...s('bus', 'Автобус'), existing: 'n3' },
    { ...s('fly', 'Самолёт', ['bus']), existing: 'n4' },
  ]), crossroads()).error;

  assert.match(error, /n2 is a fork/);
  assert.doesNotMatch(error, /Include it using existing/);
});
