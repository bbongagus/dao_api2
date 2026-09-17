import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createUsageMeter } from './usageMeter.js';

test('a meter nobody used reads zero, not NaN', () => {
  const total = createUsageMeter().total();

  assert.deepEqual(total, {
    calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, dollars: 0, unpriced: 0,
  });
});

test('it counts every call and adds up the tokens', () => {
  const meter = createUsageMeter();

  meter.add('claude-sonnet-5', { input_tokens: 100, output_tokens: 20 });
  meter.add('claude-sonnet-5', { input_tokens: 300, output_tokens: 5, cache_read_input_tokens: 1000 });

  const total = meter.total();
  assert.equal(total.calls, 2);
  assert.equal(total.input, 400);
  assert.equal(total.output, 25);
  assert.equal(total.cacheRead, 1000);
});

test('dollars are the sum of each call priced at its own model', () => {
  const meter = createUsageMeter();

  meter.add('claude-sonnet-5', { input_tokens: 1_000_000 });   // $2
  meter.add('claude-haiku-4-5', { input_tokens: 1_000_000 });  // $1

  assert.equal(meter.total().dollars, 3);
});

test('a call the API answered without usage is still counted as a call', () => {
  const meter = createUsageMeter();

  meter.add('claude-sonnet-5', undefined);

  assert.equal(meter.total().calls, 1);
  assert.equal(meter.total().dollars, 0);
});

test('an unpriced model does not throw away the whole turn\'s accounting', () => {
  const meter = createUsageMeter();
  meter.add('claude-sonnet-5', { input_tokens: 1_000_000 });

  // A model nobody priced must not lose what was already measured, and must
  // not silently read as free either.
  meter.add('claude-unpriced', { input_tokens: 1_000_000 });

  const total = meter.total();
  assert.equal(total.dollars, 2, 'the priced call still counts');
  assert.equal(total.calls, 2);
  assert.equal(total.unpriced, 1, 'and the unpriced one is visible');
});
