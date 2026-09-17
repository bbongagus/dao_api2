import { test } from 'node:test';
import assert from 'node:assert/strict';

import { costOf, UnknownModelError, PRICES } from './cost.js';

const MILLION = 1_000_000;

test('a turn costs its input and output tokens at the model\'s rates', () => {
  const cost = costOf('claude-sonnet-5', { input_tokens: MILLION, output_tokens: MILLION });

  // Claude Sonnet 5: $2 per million in, $10 per million out.
  assert.equal(cost, 12);
});

test('tokens read from the cache cost a tenth of fresh input; writing them costs a quarter more', () => {
  const read = costOf('claude-sonnet-5', { cache_read_input_tokens: MILLION });
  const written = costOf('claude-sonnet-5', { cache_creation_input_tokens: MILLION });

  assert.equal(read, 0.2);
  assert.equal(written, 2.5);
});

test('a usage object missing fields counts them as zero, not NaN', () => {
  assert.equal(costOf('claude-sonnet-5', {}), 0);
  assert.equal(costOf('claude-sonnet-5', { input_tokens: 1000 }), 0.002);
});

test('an unknown model throws — a model switch must not silently bill nothing', () => {
  assert.throws(() => costOf('claude-something-new', { input_tokens: MILLION }), UnknownModelError);
});

test('every listed price is a positive number per million tokens', () => {
  const models = Object.keys(PRICES);

  assert.ok(models.includes('claude-sonnet-5'), 'the model the agent runs on must be priced');
  for (const model of models) {
    const { input, output } = PRICES[model];
    assert.ok(input > 0 && output > 0, `${model} has a non-positive price`);
    assert.ok(output > input, `${model}: output is normally dearer than input`);
  }
});
