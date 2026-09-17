import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRequireUser } from './requireUser.js';
import { AuthError, VerifierUnavailableError } from './verifyToken.js';

/** A verifier that knows one token, and cannot check another while its key set is out of reach. */
const verifyToken = async (token) => {
  if (token === 'good') return { userId: 'google-oauth2|42' };
  if (token === 'while-the-key-set-is-down') throw new VerifierUnavailableError('ERR_JWKS_TIMEOUT');
  throw new AuthError('signature verification failed');
};

async function call(headers) {
  const warnings = [];
  const errors = [];
  const requireUser = createRequireUser(verifyToken, {
    warn: (message) => warnings.push(message),
    error: (message) => errors.push(message),
  });
  const req = { headers, method: 'GET', originalUrl: '/api/graphs/main' };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;

  await requireUser(req, res, () => { nextCalled = true; });

  return { req, res, nextCalled, warnings, errors };
}

test('a good bearer token becomes req.userId and the request goes on', async () => {
  const { req, res, nextCalled } = await call({ authorization: 'Bearer good' });

  assert.equal(req.userId, 'google-oauth2|42');
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('no Authorization header is a 401 and nothing runs', async () => {
  const { res, nextCalled } = await call({});

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'unauthorized' });
  assert.equal(nextCalled, false);
});

test('a header that is not a bearer token is a 401', async () => {
  const { res, nextCalled } = await call({ authorization: 'Basic ZGV2OmRldg==' });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('a refused token is a 401 that tells the log why and the client nothing', async () => {
  const { req, res, nextCalled, warnings } = await call({ authorization: 'Bearer forged', 'x-user-id': 'dev-user-1' });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'unauthorized' });
  assert.equal(req.userId, undefined);
  assert.equal(nextCalled, false);
  assert.match(warnings[0], /signature verification failed/);
  assert.doesNotMatch(warnings[0], /forged/);
});

test('a token that cannot be checked right now is a 503, not a refusal', async () => {
  const { req, res, nextCalled, errors } = await call({ authorization: 'Bearer while-the-key-set-is-down' });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'unavailable' });
  assert.equal(req.userId, undefined);
  assert.equal(nextCalled, false);
  assert.match(errors[0], /ERR_JWKS_TIMEOUT/);
  assert.doesNotMatch(errors[0], /while-the-key-set-is-down/);
});
