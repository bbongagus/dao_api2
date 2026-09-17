/**
 * Make the key pair a local server trusts, and write it into .env.
 *
 * The server reads AUTH_DEV_PUBLIC_KEY; `npm run token` and the live test
 * scripts sign with AUTH_DEV_PRIVATE_KEY. An existing pair is never replaced:
 * every token signed with it would stop working.
 *
 * Usage: npm run auth:dev-keys
 */

import fs from 'node:fs';

import { generateDevKeys } from '../src/auth/devToken.js';

const ENV_FILE = new URL('../.env', import.meta.url);
const DEFAULT_AUDIENCE = 'https://dao-api';

const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
const has = (name) => new RegExp(`^${name}=`, 'm').test(existing);

if (has('AUTH_DEV_PUBLIC_KEY') || has('AUTH_DEV_PRIVATE_KEY')) {
  console.log('.env already has a dev key pair; nothing written.');
  process.exit(0);
}

if (has('AUTH0_DOMAIN')) {
  console.error('.env sets AUTH0_DOMAIN; the server trusts one issuer, so comment it out before using a dev key.');
}

const { publicJwk, privateJwk } = await generateDevKeys();
const lines = [
  '',
  '# Local authentication, from npm run auth:dev-keys. The server reads only the',
  '# public key; npm run token and the live test scripts sign with the private one.',
  `AUTH_DEV_PUBLIC_KEY='${JSON.stringify(publicJwk)}'`,
  `AUTH_DEV_PRIVATE_KEY='${JSON.stringify(privateJwk)}'`,
  ...(has('AUTH_AUDIENCE') ? [] : [`AUTH_AUDIENCE=${DEFAULT_AUDIENCE}`]),
];

const separator = existing && !existing.endsWith('\n') ? '\n' : '';
fs.appendFileSync(ENV_FILE, `${separator}${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`Wrote AUTH_DEV_PUBLIC_KEY, AUTH_DEV_PRIVATE_KEY${has('AUTH_AUDIENCE') ? '' : ' and AUTH_AUDIENCE'} to .env`);
