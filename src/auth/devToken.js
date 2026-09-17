/**
 * Tokens for a local server, signed with the private half of the key pair
 * `npm run auth:dev-keys` wrote into .env. For scripts and tests only: the
 * server never imports this file and never reads AUTH_DEV_PRIVATE_KEY.
 */

import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose';

import { DEV_ISSUER } from './config.js';

export async function generateDevKeys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  return { publicJwk: await exportJWK(publicKey), privateJwk: await exportJWK(privateKey) };
}

export async function signDevToken(userId, { privateJwk, audience, expiresInSeconds = 3600, issuer = DEV_ISSUER }) {
  const key = await importJWK(typeof privateJwk === 'string' ? JSON.parse(privateJwk) : privateJwk, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(key);
}

/** signDevToken with the key and audience from the environment — .env, through --env-file. */
export async function devTokenFromEnv(userId, options = {}, env = process.env) {
  const missing = ['AUTH_DEV_PRIVATE_KEY', 'AUTH_AUDIENCE'].filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`${missing.join(' and ')} not set — run npm run auth:dev-keys, and start the script with --env-file=.env`);
  }

  return signDevToken(userId, { privateJwk: env.AUTH_DEV_PRIVATE_KEY, audience: env.AUTH_AUDIENCE, ...options });
}
