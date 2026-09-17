import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redisRetryDelay, MAX_RETRY_DELAY_MS } from './redisRetry.js';

test('a reconnect is never given up on', () => {
  // The old policy returned null after ten attempts — about fifteen seconds —
  // and the server then ran without Redis until someone redeployed it. That
  // happened for real on 2026-09-17: the local server answered "healthy" with
  // no Redis behind it for two hours.
  for (const attempt of [1, 10, 11, 100, 10_000]) {
    assert.equal(typeof redisRetryDelay(attempt), 'number', `attempt ${attempt} gave up`);
  }
});

test('the delay backs off, then holds at a cap', () => {
  assert.ok(redisRetryDelay(1) < redisRetryDelay(5), 'it should back off');
  assert.equal(redisRetryDelay(10_000), MAX_RETRY_DELAY_MS);
  assert.ok(MAX_RETRY_DELAY_MS <= 5000, 'a cap this side of a few seconds keeps recovery quick');
});

test('the first retry is prompt — a Redis blip should barely show', () => {
  assert.ok(redisRetryDelay(1) <= 200, `first retry waited ${redisRetryDelay(1)}ms`);
});
