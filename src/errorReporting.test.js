import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initErrorReporting, reportError, scrubEvent } from './errorReporting.js';

const fakeSdk = (initialized = true) => {
  const calls = { init: [], capture: [] };
  return {
    calls,
    init: (options) => calls.init.push(options),
    captureException: (error) => calls.capture.push(error),
    isInitialized: () => initialized,
  };
};

test('without SENTRY_DSN nothing is initialised', () => {
  const sdk = fakeSdk();
  assert.equal(initErrorReporting({}, sdk), false);
  assert.equal(sdk.calls.init.length, 0);
});

test('with SENTRY_DSN: errors only, no personal data', () => {
  const sdk = fakeSdk();
  assert.equal(initErrorReporting({ SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/2' }, sdk), true);
  const [options] = sdk.calls.init;
  assert.equal(options.dsn, 'https://k@o1.ingest.de.sentry.io/2');
  assert.equal(options.sendDefaultPii, false);
  assert.equal(options.tracesSampleRate, 0);
  assert.equal(options.beforeSend, scrubEvent);
  assert.equal(options.beforeBreadcrumb({ category: 'console', message: 'Buy a tent' }), null);
  assert.deepEqual(options.beforeBreadcrumb({ category: 'http' }), { category: 'http' });
});

test('scrubEvent removes bodies, cookies, headers, and everything but the user id', () => {
  const event = scrubEvent({
    request: { url: '/api/graphs/main', data: '{"title":"Leave my job"}', cookies: 'a=b', headers: { authorization: 'Bearer x' } },
    user: { id: 'auth0|1', email: 'a@b.c', ip_address: '1.2.3.4' },
    breadcrumbs: [{ category: 'console', message: 'Leave my job' }, { category: 'http' }],
  });
  assert.deepEqual(event.request, { url: '/api/graphs/main' });
  assert.deepEqual(event.user, { id: 'auth0|1' });
  assert.deepEqual(event.breadcrumbs, [{ category: 'http' }]);
  assert.ok(!JSON.stringify(event).includes('Leave my job'));
});

test('reportError sends Errors only, and only once initialised', () => {
  const on = fakeSdk(true);
  reportError(new Error('boom'), on);
  reportError('a string', on);
  assert.equal(on.calls.capture.length, 1);

  const off = fakeSdk(false);
  reportError(new Error('boom'), off);
  assert.equal(off.calls.capture.length, 0);
});
