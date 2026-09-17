import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateDevKeys, devTokenFromEnv } from './devToken.js';
import { createTokenVerifier } from './verifyToken.js';
import { readAuthConfig } from './config.js';

test('a token from the dev keys in .env passes the check the same .env configures', async () => {
  const { publicJwk, privateJwk } = await generateDevKeys();
  const env = {
    AUTH_DEV_PUBLIC_KEY: JSON.stringify(publicJwk),
    AUTH_DEV_PRIVATE_KEY: JSON.stringify(privateJwk),
    AUTH_AUDIENCE: 'https://dao-api',
  };
  const verifyToken = createTokenVerifier(readAuthConfig(env));

  const token = await devTokenFromEnv('dev-user-1', {}, env);

  assert.deepEqual(await verifyToken(token), { userId: 'dev-user-1' });
});

test('without the private key it says what to run', async () => {
  await assert.rejects(
    devTokenFromEnv('dev-user-1', {}, { AUTH_AUDIENCE: 'https://dao-api' }),
    /AUTH_DEV_PRIVATE_KEY.*auth:dev-keys/
  );
});
