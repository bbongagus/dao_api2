import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';

import { summariseStaged, shapeTurn, runGraphAgent } from './agent.js';
import { AGENT_SYSTEM_PROMPT, RAMP_PROMPT } from './agentPrompt.js';

/**
 * A runner shaped like the SDK's: `toolRunner()` hands one back synchronously,
 * it yields each message of the loop, and `done()` resolves with the last.
 */
function runnerOf(messages, error) {
  return {
    async *[Symbol.asyncIterator]() {
      if (error) throw error;
      for (const message of messages) yield message;
    },
    async done() {
      if (error) throw error;
      return messages[messages.length - 1];
    },
  };
}

/** A stub client whose toolRunner returns a canned final message, or throws. */
function stubClient(resultOrError) {
  return {
    beta: {
      messages: {
        toolRunner() {
          return resultOrError instanceof Error
            ? runnerOf([], resultOrError)
            : runnerOf([resultOrError]);
        },
      },
    },
  };
}

const noEmit = () => {};

test('staged operations are counted by kind', () => {
  const counts = summariseStaged([
    { op: 'add' }, { op: 'add' }, { op: 'update' }, { op: 'delete' }, { op: 'link' },
  ]);

  assert.deepEqual(counts, { add: 2, update: 1, delete: 1 });
});

test('a turn that staged nothing comes back as text', () => {
  const turn = shapeTurn({ staged: [], summary: 'Ничего менять не нужно.' });

  assert.equal(turn.type, 'text');
  assert.equal(turn.message, 'Ничего менять не нужно.');
});

test('a turn that staged nothing and said nothing still says something', () => {
  const turn = shapeTurn({ staged: [], summary: '' });

  assert.equal(turn.type, 'text');
  assert.match(turn.message, /\p{L}/u);
});

test('a turn with operations carries them, a summary and counts', () => {
  const turn = shapeTurn({
    staged: [{ op: 'add', alias: 'x' }, { op: 'delete', target: 'real-1' }],
    summary: 'Добавил одно, убрал другое.',
  });

  assert.equal(turn.type, 'changes');
  assert.equal(turn.operations.length, 2);
  assert.equal(turn.summary, 'Добавил одно, убрал другое.');
  assert.deepEqual(turn.counts, { add: 1, update: 0, delete: 1 });
});

test('a runaway set is refused rather than offered', () => {
  const staged = Array.from({ length: 31 }, () => ({ op: 'add' }));

  const turn = shapeTurn({ staged, summary: 'всё сразу' });

  assert.equal(turn.type, 'text');
  assert.match(turn.message, /31/);
});

test('exactly MAX_OPERATIONS (30) is still offered, not refused', () => {
  const staged = Array.from({ length: 30 }, () => ({ op: 'add' }));

  const turn = shapeTurn({ staged, summary: 'ровно тридцать' });

  assert.equal(turn.type, 'changes');
  assert.equal(turn.operations.length, 30);
});

test('a turn that ran out of iterations still offers what it staged', () => {
  const turn = shapeTurn({
    staged: [{ op: 'add', alias: 'x' }],
    summary: 'Начал разбирать.',
    stoppedEarly: true,
  });

  assert.equal(turn.type, 'changes');
  assert.match(turn.summary, /Начал разбирать/);
  // Substance, not just "not identical to the input": the summary must
  // actually say the turn stopped early, not merely differ by whitespace.
  assert.match(turn.summary, /stopped part-way through/);
  assert.match(turn.summary, /ask me to carry on/);
});

test('iterations exhausted before staging anything says so, not that there was nothing to do', () => {
  const turn = shapeTurn({ staged: [], summary: '', stoppedEarly: true });

  assert.equal(turn.type, 'text');
  // Must not fall back to the "nothing to change" message — that would be a
  // false statement about what happened.
  assert.doesNotMatch(turn.message, /did not find anything to change/);
  assert.match(turn.message, /ran out of room/);
  assert.match(turn.message, /continue/);
});

test('iterations exhausted before staging anything, but with something already said, still says it ran out of room', () => {
  const turn = shapeTurn({ staged: [], summary: 'Начал смотреть граф.', stoppedEarly: true });

  assert.equal(turn.type, 'text');
  assert.match(turn.message, /Начал смотреть граф/);
  assert.match(turn.message, /ran out of room/);
});

// --- runGraphAgent, driven by a stub client (no network) ---

test('a stop_reason of max_tokens is treated as stopped early, not inferred from block types', async () => {
  const client = stubClient({
    content: [{ type: 'text', text: 'Частичный ответ, не закончен.' }],
    stop_reason: 'max_tokens',
  });

  const turn = await runGraphAgent({
    client,
    model: 'claude-sonnet-5',
    nodes: [],
    currentPath: [],
    messages: [{ role: 'user', content: 'расскажи всё, что есть в графе' }],
    emit: noEmit,
  });

  // Nothing was staged (the stub never runs a tool), so this exercises the
  // stopped-early + nothing-staged path — and it must say so honestly.
  assert.equal(turn.type, 'text');
  assert.match(turn.message, /ran out of room/);
  assert.doesNotMatch(turn.message, /did not find anything to change/);
});

test('a stop_reason of tool_use with no further tool call (iterations exhausted) is treated as stopped early', async () => {
  const client = stubClient({
    content: [
      { type: 'text', text: '' },
      { type: 'tool_use', id: 'toolu_1', name: 'inspect', input: { alias: 'n1', depth: 1 } },
    ],
    stop_reason: 'tool_use',
  });

  const turn = await runGraphAgent({
    client,
    model: 'claude-sonnet-5',
    nodes: [],
    currentPath: [],
    messages: [{ role: 'user', content: 'посмотри граф внимательно' }],
    emit: noEmit,
  });

  assert.equal(turn.type, 'text');
  assert.match(turn.message, /ran out of room/);
});

test('model_context_window_exceeded is treated as stopped early', async () => {
  const client = stubClient({
    content: [{ type: 'text', text: 'Граф слишком большой, не уместился.' }],
    stop_reason: 'model_context_window_exceeded',
  });

  const turn = await runGraphAgent({
    client,
    model: 'claude-sonnet-5',
    nodes: [],
    currentPath: [],
    messages: [{ role: 'user', content: 'разбери весь граф' }],
    emit: noEmit,
  });

  assert.equal(turn.type, 'text');
  assert.match(turn.message, /Граф слишком большой/);
  assert.match(turn.message, /ran out of room/);
});

test('end_turn with a text block is a normal, complete turn — not stopped early', async () => {
  const client = stubClient({
    content: [{ type: 'text', text: 'В графе пока пусто.' }],
    stop_reason: 'end_turn',
  });

  const turn = await runGraphAgent({
    client,
    model: 'claude-sonnet-5',
    nodes: [],
    currentPath: [],
    messages: [{ role: 'user', content: 'что в графе?' }],
    emit: noEmit,
  });

  assert.equal(turn.type, 'text');
  assert.equal(turn.message, 'В графе пока пусто.');
  assert.doesNotMatch(turn.message, /ran out of room/);
});

test('a RateLimitError thrown by the runner comes back as an error turn, not a rejection', async () => {
  const client = stubClient(
    new Anthropic.RateLimitError(429, { type: 'rate_limit_error' }, 'slow down', new Headers()),
  );

  const turn = await runGraphAgent({
    client,
    model: 'claude-sonnet-5',
    nodes: [],
    currentPath: [],
    messages: [{ role: 'user', content: 'привет' }],
    emit: noEmit,
  });

  assert.equal(turn.type, 'error');
  assert.match(turn.message, /\p{L}/u);
});

test('an APIConnectionError thrown by the runner comes back as an error turn, not a rejection', async () => {
  const client = stubClient(new Anthropic.APIConnectionError({ message: 'fetch failed' }));

  const turn = await runGraphAgent({
    client,
    model: 'claude-sonnet-5',
    nodes: [],
    currentPath: [],
    messages: [{ role: 'user', content: 'привет' }],
    emit: noEmit,
  });

  assert.equal(turn.type, 'error');
  assert.match(turn.message, /\p{L}/u);
});

test('a generic APIError thrown by the runner comes back as an error turn carrying the status', async () => {
  const client = stubClient(
    new Anthropic.InternalServerError(500, { type: 'api_error' }, 'server exploded', new Headers()),
  );

  const turn = await runGraphAgent({
    client,
    model: 'claude-sonnet-5',
    nodes: [],
    currentPath: [],
    messages: [{ role: 'user', content: 'привет' }],
    emit: noEmit,
  });

  assert.equal(turn.type, 'error');
  assert.match(turn.message, /500/);
});

test('a non-API error thrown by the runner still comes back as an error turn, not a rejection', async () => {
  const client = stubClient(new TypeError('something unrelated broke'));

  const turn = await runGraphAgent({
    client,
    model: 'claude-sonnet-5',
    nodes: [],
    currentPath: [],
    messages: [{ role: 'user', content: 'привет' }],
    emit: noEmit,
  });

  assert.equal(turn.type, 'error');
  assert.match(turn.message, /\p{L}/u);
});

// --- runGraphAgent, driven by a stub that calls the agent's own tools ---

/** A stub client whose toolRunner runs the given tool calls, then ends the turn. */
function scriptedClient(calls, results = []) {
  return {
    beta: {
      messages: {
        toolRunner({ tools }) {
          const ran = (async () => {
            for (const [name, input] of calls) {
              results.push(await tools.find((t) => t.name === name).run(input));
            }
            return { content: [{ type: 'text', text: 'Готово.' }], stop_reason: 'end_turn' };
          })();
          return {
            async *[Symbol.asyncIterator]() { yield await ran; },
            async done() { return ran; },
          };
        },
      },
    },
  };
}

const connectedGraph = {
  nodes: [
    { id: 'stage', title: 'Этап', nodeType: 'fundamental', nodeSubtype: 'downstream', description: '', children: [] },
    { id: 'task', title: 'Задача', nodeType: 'dao', nodeSubtype: 'simple', description: '', children: [] },
  ],
  edges: [{ id: 'e1', source: 'stage', target: 'task' }],
};

const runScripted = (calls, extra = {}) => {
  const results = [];
  const turn = runGraphAgent({
    client: scriptedClient(calls, results),
    model: 'claude-sonnet-5',
    ...connectedGraph,
    currentPath: [],
    messages: [{ role: 'user', content: 'что тут связано?' }],
    emit: noEmit,
    ...extra,
  });
  return { turn, results };
};

test('the agent reads links from the graph edges it was given', async () => {
  const { turn, results } = runScripted([['overview', {}]]);
  await turn;

  assert.match(results[0], /n1 → n2/);
});

test('the agent does not stage a link the graph already has', async () => {
  const { turn } = runScripted([['link_nodes', { source: 'n1', target: 'n2' }]]);

  assert.equal((await turn).type, 'text');
});

test('every tool call is reported with what it was asked and what it answered', async () => {
  const calls = [];
  const { turn } = runScripted(
    [['overview', {}], ['link_nodes', { source: 'n1', target: 'n2' }]],
    { onToolCall: (call) => calls.push(call) },
  );
  await turn;

  assert.deepEqual(calls.map((c) => c.name), ['overview', 'link_nodes']);
  assert.deepEqual(calls[1].input, { source: 'n1', target: 'n2' });
  assert.match(calls[1].result, /already connected/);
});

test('a plan is offered even when its arrows run past the operation cap', () => {
  const staged = Array.from({ length: 45 }, () => ({ op: 'link', plan: true }));

  assert.equal(shapeTurn({ staged, summary: 'план' }).type, 'changes');
});

test('the agent can lay out a plan through plan_path', async () => {
  const step = (id, title, after = []) => ({ id, title, description: '', after, checklist: [], repeat: 0 });
  const statuses = [];
  const { turn } = runScripted(
    [['plan_path', {
      section: '', sectionTitle: 'Переезд', sectionDescription: '',
      stages: [{ id: 'visa', title: 'Виза получена', description: '', after: [], steps: [step('apply', 'Подать на визу')] }],
    }]],
    { emit: (e) => { if (e.type === 'status') statuses.push(e.text); } },
  );

  const result = await turn;

  assert.equal(result.type, 'changes');
  assert.ok(result.operations.some((o) => o.nodeSubtype === 'upstream'));
  assert.ok(statuses.includes('planning "Переезд"'));
});


// --- what the turn cost ---

test('a turn reports what it spent, summed over every iteration of the loop', async () => {
  const client = {
    beta: {
      messages: {
        toolRunner: () => runnerOf([
          { content: [], stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 100 } },
          { content: [{ type: 'text', text: 'Готово.' }], stop_reason: 'end_turn',
            usage: { input_tokens: 2000, output_tokens: 50, cache_read_input_tokens: 500 } },
        ]),
      },
    },
  };

  const turn = await runGraphAgent({
    client, model: 'claude-sonnet-5', nodes: [], edges: [], currentPath: [],
    messages: [{ role: 'user', content: 'привет' }], emit: noEmit,
  });

  assert.equal(turn.usage.calls, 2, 'both iterations are billed');
  assert.equal(turn.usage.input, 3000);
  assert.equal(turn.usage.output, 150);
  assert.equal(turn.usage.cacheRead, 500);
  assert.ok(turn.usage.dollars > 0, 'a turn that ran is never free');
});

test('a turn that failed still reports what it spent before failing', async () => {
  const client = {
    beta: {
      messages: {
        toolRunner: () => ({
          async *[Symbol.asyncIterator]() {
            yield { content: [], stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 10 } };
            throw new Anthropic.RateLimitError(429, {}, 'rate limited', {});
          },
          async done() { throw new Anthropic.RateLimitError(429, {}, 'rate limited', {}); },
        }),
      },
    },
  };

  const turn = await runGraphAgent({
    client, model: 'claude-sonnet-5', nodes: [], edges: [], currentPath: [],
    messages: [{ role: 'user', content: 'привет' }], emit: noEmit,
  });

  assert.equal(turn.type, 'error');
  assert.equal(turn.usage.calls, 1, 'the iteration that ran before the failure is billed');
  assert.ok(turn.usage.dollars > 0);
});

// --- caching ---

test('the loop asks for the growing conversation to be cached, not only the system prompt', async () => {
  let sent = null;
  const client = {
    beta: {
      messages: {
        toolRunner(params) {
          sent = params;
          return runnerOf([{ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }]);
        },
      },
    },
  };

  await runGraphAgent({
    client, model: 'claude-sonnet-5', nodes: [], edges: [], currentPath: [],
    messages: [{ role: 'user', content: 'привет' }], emit: noEmit,
  });

  // The system prefix keeps its own guaranteed read point...
  assert.deepEqual(sent.system.at(-1).cache_control, { type: 'ephemeral' });
  // ...and the top-level marker moves with the tail, so iteration N reads what
  // iteration N-1 wrote instead of re-billing the whole history uncached.
  assert.deepEqual(sent.cache_control, { type: 'ephemeral' });
});

test('nothing in the cached prefix changes between iterations of one turn', async () => {
  const seen = [];
  const client = {
    beta: {
      messages: {
        toolRunner(params) {
          seen.push(JSON.stringify({ system: params.system, tools: params.tools.map((t) => t.name), model: params.model }));
          return runnerOf([{ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }]);
        },
      },
    },
  };

  const run = () => runGraphAgent({
    client, model: 'claude-sonnet-5', nodes: [], edges: [], currentPath: [],
    messages: [{ role: 'user', content: 'привет' }], emit: noEmit,
  });
  await run();
  await run();

  assert.equal(seen[0], seen[1], 'system, tool order and model must be byte-identical or the cache never reads');
});

test('a ramp turn adds its instructions after the system prompt, which stays byte-identical', async () => {
  const sent = [];
  const client = {
    beta: {
      messages: {
        toolRunner(params) {
          sent.push(params.system);
          return runnerOf([{ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }]);
        },
      },
    },
  };

  const run = (mode) => runGraphAgent({
    client, model: 'claude-sonnet-5', nodes: [], edges: [], currentPath: [], mode,
    messages: [{ role: 'user', content: 'хочу накачаться' }], emit: noEmit,
  });
  await run(undefined);
  await run('ramp');

  const [ordinary, ramp] = sent;
  assert.equal(ordinary.length, 1);
  assert.equal(ramp.length, 2);
  // The first block is what both modes share a cache read on.
  assert.equal(JSON.stringify(ramp[0]), JSON.stringify(ordinary[0]));
  assert.equal(ramp[0].text, AGENT_SYSTEM_PROMPT);
  assert.equal(ramp[1].text, RAMP_PROMPT);
  assert.deepEqual(ramp[1].cache_control, { type: 'ephemeral' });
});

test('update_node asks only for what a node without Kata can change', async () => {
  let tools;
  const final = { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} };
  const client = {
    beta: {
      messages: {
        toolRunner(params) {
          tools = params.tools;
          return runnerOf([final]);
        },
      },
    },
  };

  await runGraphAgent({
    client, model: 'claude-sonnet-5', nodes: [], edges: [], currentPath: [],
    messages: [{ role: 'user', content: 'привет' }], emit: noEmit,
  });

  const update = tools.find((t) => t.name === 'update_node');
  assert.deepEqual(Object.keys(update.input_schema.properties), ['target', 'title', 'description', 'kind']);
});

// --- giving up when the person leaves ---

test('the caller\'s abort signal is handed to the runner', async () => {
  let options = null;
  const controller = new AbortController();
  const client = {
    beta: {
      messages: {
        toolRunner(_params, opts) {
          options = opts;
          return runnerOf([{ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }]);
        },
      },
    },
  };

  await runGraphAgent({
    client, model: 'claude-sonnet-5', nodes: [], edges: [], currentPath: [],
    messages: [{ role: 'user', content: 'привет' }], emit: noEmit, signal: controller.signal,
  });

  assert.equal(options?.signal, controller.signal);
});

test('a turn the person walked away from reads as cancelled, not as an API failure', async () => {
  const client = {
    beta: {
      messages: {
        toolRunner: () => ({
          async *[Symbol.asyncIterator]() {
            yield { content: [], stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 10 } };
            throw new Anthropic.APIUserAbortError();
          },
          async done() { throw new Anthropic.APIUserAbortError(); },
        }),
      },
    },
  };

  const turn = await runGraphAgent({
    client, model: 'claude-sonnet-5', nodes: [], edges: [], currentPath: [],
    messages: [{ role: 'user', content: 'привет' }], emit: noEmit,
  });

  // APIUserAbortError is itself an APIError, so without its own branch this
  // was journalled as "Claude's API returned an error" — which it was not.
  assert.equal(turn.type, 'cancelled');
  assert.equal(turn.usage.calls, 1, 'what it spent before being stopped is still charged');
});
