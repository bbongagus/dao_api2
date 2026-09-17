import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRequireUser } from './requireUser.js';
import { AuthError } from './verifyToken.js';

/** A verifier that knows one token. */
const verifyToken = async (token) => {
  if (token === 'good') return { userId: 'google-oauth2|42' };
  throw new AuthError('signature verification failed');
};

async function call(headers) {
  const warnings = [];
  const requireUser = createRequireUser(verifyToken, { warn: (message) => warnings.push(message) });
  const req = { headers, method: 'GET', originalUrl: '/api/graphs/main' };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;

  await requireUser(req, res, () => { nextCalled = true; });

  return { req, res, nextCalled, warnings };
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
