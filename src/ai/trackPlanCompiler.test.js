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
