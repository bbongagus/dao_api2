import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';

import { summariseStaged, shapeTurn, runGraphAgent } from './agent.js';

/** A stub client whose toolRunner returns a canned final message, or throws. */
function stubClient(resultOrError) {
  return {
    beta: {
      messages: {
        async toolRunner() {
          if (resultOrError instanceof Error) throw resultOrError;
          return resultOrError;
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
