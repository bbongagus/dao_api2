// dao_api2/src/ai/agentPrompt.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAliasTable } from './aliases.js';
import { AGENT_SYSTEM_PROMPT, describeWhereUserIs } from './agentPrompt.js';
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
