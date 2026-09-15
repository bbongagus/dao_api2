// dao_api2/src/ai/agentPrompt.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAliasTable } from './aliases.js';
import { AGENT_SYSTEM_PROMPT, describeWhereUserIs, KIND_GLOSS } from './agentPrompt.js';
import { KIND_LIST } from './graphWriteTools.js';

test('the prompt carries the shared graph semantics', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /without weighting them/);
  assert.match(AGENT_SYSTEM_PROMPT, /A chain counts every node/);
});

test('the prompt names every kind the write tools accept', () => {
  for (const kind of KIND_LIST) {
    assert.match(AGENT_SYSTEM_PROMPT, new RegExp(kind.replace('-', '\\-')));
  }
});

test('the prompt tells the agent it must look before it changes', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /overview/);
  assert.match(AGENT_SYSTEM_PROMPT, /inspect/);
});

test('the prompt never mentions uuids', () => {
  assert.equal(/uuid/i.test(AGENT_SYSTEM_PROMPT), false);
});

test('where the user stands is described by title, not id', () => {
  const graph = [{
    id: 'health', title: 'Здоровье', nodeType: 'fundamental', nodeSubtype: 'category',
    description: '', linkedNodeIds: {},
    children: [{ id: 'run', title: 'Бег', nodeType: 'dao', nodeSubtype: 'simple', description: '', children: [], linkedNodeIds: {} }],
  }];

  const said = describeWhereUserIs(['health'], buildAliasTable(graph));

  assert.match(said, /Здоровье/);
  assert.match(said, /n1/);
  assert.equal(said.includes('health'), false);
});

test('at the top level it says so', () => {
  const said = describeWhereUserIs([], buildAliasTable([]));

  assert.match(said, /\p{L}/u);
  assert.equal(said.includes('n1'), false);
});

test('a path naming a node that is gone degrades to the top level', () => {
  const said = describeWhereUserIs(['vanished'], buildAliasTable([]));

  assert.match(said, /\p{L}/u);
});

test('every kind the tools accept has a gloss in the prompt', () => {
  for (const kind of KIND_LIST) {
    assert(KIND_GLOSS[kind], `KIND_GLOSS missing for ${kind}`);
    assert(KIND_GLOSS[kind].length > 0, `KIND_GLOSS empty for ${kind}`);
    assert.match(AGENT_SYSTEM_PROMPT, new RegExp('`' + kind.replace('-', '\\-') + '`\\s+—'));
  }
});

test('the prompt keeps n-names out of what the person reads', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /by title/i);
});

test('the closing words propose rather than report, since nothing is applied yet', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /what you propose, not what you did/i);
});

test('the closing words are plain prose: no headings, bold or bullets', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /no headings, no bold, no bullet points/i);
});

test('an arrow is taught as order, not only as feeding in', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /cannot start before/);
  assert.doesNotMatch(AGENT_SYSTEM_PROMPT, /not "do this next"/);
});

test('milestones are no longer told to sit side by side', () => {
  assert.doesNotMatch(AGENT_SYSTEM_PROMPT, /Milestones should sit side by side/);
});

test('stages that follow each other are closed by a Mi', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /stops at the previous Mi/);
});

test('plans are built with plan_path, in outcomes and prerequisites', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /plan_path/);
  assert.match(AGENT_SYSTEM_PROMPT, /prerequisites/);
  assert.match(AGENT_SYSTEM_PROMPT, /checklist/);
});

test('after a plan the agent names what can be started today', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /started today/);
});
