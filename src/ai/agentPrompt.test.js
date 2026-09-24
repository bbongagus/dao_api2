// dao_api2/src/ai/agentPrompt.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAliasTable } from './aliases.js';
import { AGENT_SYSTEM_PROMPT, RAMP_PROMPT, describeWhereUserIs, KIND_GLOSS } from './agentPrompt.js';
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

test('the prompt does not send a restructure to plan_path, which only appends', () => {
  assert.equal(/rebuild a section/.test(AGENT_SYSTEM_PROMPT), false);
  assert.match(AGENT_SYSTEM_PROMPT, /does not replace what a section already holds/);
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

test('the Mi gloss says the work since the previous Mi', () => {
  assert.match(KIND_GLOSS.mi, /previous Mi/);
  assert.doesNotMatch(KIND_GLOSS.mi, /everything reachable/);
});

test('the prompt no longer teaches a hand-linked sequence toward a milestone', () => {
  assert.doesNotMatch(AGENT_SYSTEM_PROMPT, /a sequence of work toward a milestone/);
});

test('the semantics say a Kai also stops a Mi\'s walk', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /or at a Kai/);
});

test('the prompt names the kinds the way the person sees them', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /Task/);
  assert.match(AGENT_SYSTEM_PROMPT, /Group/);
  assert.match(AGENT_SYSTEM_PROMPT, /Track/);
  assert.match(AGENT_SYSTEM_PROMPT, /Milestone/);
  assert.doesNotMatch(AGENT_SYSTEM_PROMPT, /kata|repeatable/i);
});

test('the ramp knows the idea was already asked for, and ends in plan_path', () => {
  assert.match(RAMP_PROMPT, /already been asked/);
  assert.match(RAMP_PROMPT, /plan_path/);
});

test('the ramp lets the person stop the questions', () => {
  assert.match(RAMP_PROMPT, /хватит/iu);
  assert.match(RAMP_PROMPT, /не знаю/iu);
});

test('the ramp tries a wish before committing to it, and checks it against what the person has', () => {
  assert.match(RAMP_PROMPT, /rent before buying/);
  assert.match(RAMP_PROMPT, /falls short/);
});

test('the ramp never plans without the outcome, and ends the plan on it', () => {
  assert.match(RAMP_PROMPT, /Never plan without it/);
  assert.match(RAMP_PROMPT, /the last stage is the outcome/);
});

test('the ramp keeps quiet about its tools, and promises nothing for later', () => {
  assert.match(RAMP_PROMPT, /Never tell them about your tools/);
  assert.match(RAMP_PROMPT, /never promise to do\s+something in a later message/);
});
// What reading GPT-6 Luna's plans showed: stages chained by calendar, a
// fixed three items a checklist, the person's own route rebuilt around a
// doubt, the last stage an activity rather than the goal.

test('an arrow is a dependency, not calendar order — and an arrow where there is none is a mistake too', () => {
  assert.doesNotMatch(AGENT_SYSTEM_PROMPT, /Left to right, in time/);
  assert.match(AGENT_SYSTEM_PROMPT, /not\s+"this\s+usually\s+comes\s+later"/);
  assert.match(AGENT_SYSTEM_PROMPT, /hides\s+work\s+that\s+could\s+start\s+now/);
});

test('a stage waits only for what it cannot start without, and every after is questioned before plan_path', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /cannot\s+start\s+without/);
  assert.match(AGENT_SYSTEM_PROMPT, /could\s+this\s+stage\s+start\s+without\s+that\s+one/);
  assert.match(AGENT_SYSTEM_PROMPT, /do\s+not\s+turn\s+the\s+months\s+into\s+a\s+chain/);
});

test('the last stage is the goal reached, not the activity toward it', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /The\s+last\s+stage\s+is\s+the\s+goal\s+itself,\s+reached/);
});

test("the person's own route is planned, and a legal condition lives in the one step it concerns", () => {
  assert.match(AGENT_SYSTEM_PROMPT, /plan\s+that\s+route:\s+it\s+is\s+their\s+decision/);
  assert.match(AGENT_SYSTEM_PROMPT, /Nowhere\s+else/);
  assert.match(AGENT_SYSTEM_PROMPT, /reads\s+as\s+distrust/);
  assert.match(AGENT_SYSTEM_PROMPT, /beginning\s+with\s+the\s+plan\s+itself/);
});

test('a checklist holds what the step really has, and its description does not repeat it', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /not\s+a\s+set\s+number/);
  assert.match(AGENT_SYSTEM_PROMPT, /does\s+not\s+list\s+the\s+checklist\s+again/);
});

test('real names, and finding one out rather than inventing it', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /rather\s+than\s+inventing\s+one/);
});

test('the ramp never asks the same question twice, and repeats count against the four', () => {
  assert.match(RAMP_PROMPT, /Never\s+ask\s+the\s+same\s+question\s+twice/);
  assert.match(RAMP_PROMPT, /repeats\s+included/);
  assert.match(RAMP_PROMPT, /plan\s+toward\s+the\s+likeliest/);
});

test('the ramp asks which idea first once, and its examples invent no money', () => {
  assert.match(RAMP_PROMPT, /once:\s+if\s+the\s+answer\s+does\s+not\s+say/);
  assert.match(RAMP_PROMPT, /name\s+no\s+amount\s+and\s+no\s+currency/);
  assert.match(RAMP_PROMPT, /«заложил»/);
});

test('the prompt sends "I did it" to the task list, matched by meaning, and to mark_done', () => {
  assert.match(AGENT_SYSTEM_PROMPT, /## When the person says they did something/);
  assert.match(AGENT_SYSTEM_PROMPT, /`tasks`/);
  assert.match(AGENT_SYSTEM_PROMPT, /by meaning/);
  assert.match(AGENT_SYSTEM_PROMPT, /`mark_done`/);
});
