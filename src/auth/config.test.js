import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAuthConfig, DEV_ISSUER } from './config.js';

const PUBLIC_JWK = { kty: 'RSA', n: 'sXch', e: 'AQAB' };
const AUDIENCE = 'https://dao-api';

test('an Auth0 domain yields its issuer and key set', () => {
  const config = readAuthConfig({ AUTH0_DOMAIN: 'dev-x.us.auth0.com', AUTH_AUDIENCE: AUDIENCE });

  assert.deepEqual(config, {
    issuer: 'https://dev-x.us.auth0.com/',
    audience: AUDIENCE,
    jwksUrl: 'https://dev-x.us.auth0.com/.well-known/jwks.json',
  });
});

test('a domain written as a URL gives the same issuer', () => {
  const config = readAuthConfig({ AUTH0_DOMAIN: 'https://dev-x.us.auth0.com/', AUTH_AUDIENCE: AUDIENCE });

  assert.equal(config.issuer, 'https://dev-x.us.auth0.com/');
});

test('a dev public key yields the dev issuer', () => {
  const config = readAuthConfig({ AUTH_DEV_PUBLIC_KEY: JSON.stringify(PUBLIC_JWK), AUTH_AUDIENCE: AUDIENCE });

  assert.deepEqual(config, { issuer: DEV_ISSUER, audience: AUDIENCE, publicJwk: PUBLIC_JWK });
});

test('no audience is refused', () => {
  assert.throws(() => readAuthConfig({ AUTH0_DOMAIN: 'dev-x.us.auth0.com' }), /AUTH_AUDIENCE/);
});

test('the missing audience says where to get one', () => {
  assert.throws(
    () => readAuthConfig({ AUTH_DEV_PUBLIC_KEY: JSON.stringify(PUBLIC_JWK) }),
    /npm run auth:dev-keys.*Railway/
  );
});

test('no issuer at all is refused — there is no mode without verification', () => {
  assert.throws(() => readAuthConfig({ AUTH_AUDIENCE: AUDIENCE }), /AUTH0_DOMAIN.*AUTH_DEV_PUBLIC_KEY/);
});

test('both issuers at once are refused', () => {
  assert.throws(
    () => readAuthConfig({
      AUTH0_DOMAIN: 'dev-x.us.auth0.com',
      AUTH_DEV_PUBLIC_KEY: JSON.stringify(PUBLIC_JWK),
      AUTH_AUDIENCE: AUDIENCE,
    }),
    /not both/
  );
});

test('the dev key is refused in production', () => {
  assert.throws(
    () => readAuthConfig({ AUTH_DEV_PUBLIC_KEY: JSON.stringify(PUBLIC_JWK), AUTH_AUDIENCE: AUDIENCE, NODE_ENV: 'production' }),
    /production/
  );
});

test('a private key in the public key variable is refused', () => {
  const privateJwk = { ...PUBLIC_JWK, d: 'secret' };

  assert.throws(
    () => readAuthConfig({ AUTH_DEV_PUBLIC_KEY: JSON.stringify(privateJwk), AUTH_AUDIENCE: AUDIENCE }),
    /public half/
  );
});

test('a dev key that is not JSON is refused', () => {
  assert.throws(() => readAuthConfig({ AUTH_DEV_PUBLIC_KEY: 'abc', AUTH_AUDIENCE: AUDIENCE }), /JSON/);
});
