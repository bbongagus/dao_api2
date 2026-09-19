import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logger, setErrorReporter } from './logger.js';

test('logger.error reports the first Error among its arguments', (t) => {
  const reported = [];
  setErrorReporter((error) => reported.push(error));
  t.after(() => setErrorReporter(null));
  t.mock.method(console, 'error', () => {});

  const boom = new Error('boom');
  logger.error('Save failed:', boom);
  logger.error('just words');

  assert.deepEqual(reported, [boom]);
});
