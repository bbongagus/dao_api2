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

test('a model reached through another host states its own cache rates — no Anthropic premium on writes', () => {
  // GLM-5.3-Flash through OpenRouter: $0.15 in, $0.50 out, cache reads $0.03.
  assert.equal(costOf('z-ai/glm-5.3-flash', { cache_creation_input_tokens: MILLION }), 0.15);
  assert.equal(costOf('z-ai/glm-5.3-flash', { cache_read_input_tokens: MILLION }), 0.03);
  for (const model of Object.keys(PRICES).filter((m) => m.includes('/') && !m.startsWith('anthropic/'))) {
    assert.ok(PRICES[model].cacheRead > 0 && PRICES[model].cacheWrite > 0, `${model} needs explicit cache rates`);
  }
});

test('isPriced says whether a turn on a model can be charged at all', async () => {
  const { isPriced } = await import('./cost.js');
  assert.equal(isPriced('claude-sonnet-5'), true);
  assert.equal(isPriced('deepseek/deepseek-v4.1-flash'), true);
  assert.equal(isPriced('someone/new-model'), false);
  assert.equal(isPriced('constructor'), false, 'a prototype key is not a price');
});
