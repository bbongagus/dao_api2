import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from 'jose';

import { createTokenVerifier, AuthError } from './verifyToken.js';

const ISSUER = 'dao-dev';
const AUDIENCE = 'https://dao-api';

let trusted;   // the key pair the verifier trusts
let stranger;  // a key pair it has never seen
let verifyToken;

before(async () => {
  trusted = await generateKeyPair('RS256', { extractable: true });
  stranger = await generateKeyPair('RS256');
  verifyToken = createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, publicJwk: await exportJWK(trusted.publicKey) });
});

/** A token as the trusted issuer would sign it. Each override changes one thing; null leaves a claim out. */
function sign(overrides = {}) {
  const claims = { sub: 'google-oauth2|42', iss: ISSUER, aud: AUDIENCE, exp: '1h', key: trusted.privateKey, ...overrides };
  let jwt = new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuedAt();
  if (claims.sub !== null) jwt = jwt.setSubject(claims.sub);
  if (claims.iss !== null) jwt = jwt.setIssuer(claims.iss);
  if (claims.aud !== null) jwt = jwt.setAudience(claims.aud);
  if (claims.exp !== null) jwt = jwt.setExpirationTime(claims.exp);
  return jwt.sign(claims.key);
}

const refuses = (promise) => assert.rejects(promise, AuthError);

test('a token signed by the trusted key is the user it names', async () => {
  assert.deepEqual(await verifyToken(await sign()), { userId: 'google-oauth2|42' });
});

test('a token signed by another key is refused', async () => {
  await refuses(verifyToken(await sign({ key: stranger.privateKey })));
});

test('another issuer is refused', async () => {
  await refuses(verifyToken(await sign({ iss: 'https://evil.example/' })));
});

test('another audience is refused', async () => {
  await refuses(verifyToken(await sign({ aud: 'https://other-api' })));
});

test('an expired token is refused', async () => {
  await refuses(verifyToken(await sign({ exp: Math.floor(Date.now() / 1000) - 60 })));
});

test('a token with no expiry is refused', async () => {
  await refuses(verifyToken(await sign({ exp: null })));
});

test('a token with no subject is refused', async () => {
  await refuses(verifyToken(await sign({ sub: null })));
});

test('a subject containing ":" is refused — it would break the Redis key', async () => {
  await refuses(verifyToken(await sign({ sub: 'a:graph:b' })));
});

test('an unsigned token (alg none) is refused', async () => {
  const token = new UnsecuredJWT({ sub: 'google-oauth2|42' })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('1h').encode();

  await refuses(verifyToken(token));
});

test('an HS256 token keyed with the public key is refused', async () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({ sub: 'google-oauth2|42', iss: ISSUER, aud: AUDIENCE, iat: now, exp: now + 3600 });
  const secret = JSON.stringify(await exportJWK(trusted.publicKey));
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');

  await refuses(verifyToken(`${head}.${body}.${signature}`));
});

test('garbage is refused', async () => {
  await refuses(verifyToken('not.a.token'));
});

test('no token at all is refused', async () => {
  await refuses(verifyToken(undefined));
  await refuses(verifyToken(''));
});
