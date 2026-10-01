import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAliasTable } from './aliases.js';
import { compilePlan } from './planCompiler.js';
import { projectDraft } from './graphDraft.js';
import { createWriteTools } from './graphWriteTools.js';
import { trackReworkFixture } from './fixtures/trackRework.js';

export function checkTrack(draft, original) {
  const track = draft.aliases.nodeAt(original.aliases.aliasOf('area'));
  assert.equal(track.nodeSubtype,'downstream'); assert.equal(track.children.length,0);
  const all = draft.aliases.all.map(e=>e.node);
  assert.equal(all.filter(n=>n.nodeType==='fundamental'&&n.nodeSubtype==='category').length,0);
  const milestones=all.filter(n=>n.nodeSubtype==='upstream'); assert.equal(milestones.length,4);
  const children = all.filter(n=>n.nodeType==='dao'&&n.children.length);
  assert.equal(children.length,4); assert.ok(children.every(n=>n.children.length===7));
  for(const {node} of original.aliases.all) {
    if(['area','week1','week2','week3','week4'].includes(node.id)) continue;
    const kept=all.find(n=>n.id===node.id); assert.ok(kept,node.title);
    assert.equal(kept.isDone,node.isDone); assert.equal(kept.doneAt,node.doneAt);
  }
  const reachable=new Set();
  const visit=id=>{if(reachable.has(id))return; reachable.add(id); draft.edges.filter(e=>e.source===id).forEach(e=>visit(e.target));}; visit('area');
  for(const n of draft.nodes.filter(n=>n.id!=='unrelated')) assert.ok(reachable.has(n.id),`unreachable ${n.title}`);
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
  assert.ok(result.operations.filter(o=>o.op==='add'&&!/plan:b:calls:/.test(o.alias)).every(o=>o.parent===null));
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
