import { test } from 'node:test';
import assert from 'node:assert/strict';

import { allowedOrigins, isOriginAllowed } from './corsPolicy.js';

test('CORS_ORIGINS, when set, is the whole list', () => {
  const list = allowedOrigins({ CORS_ORIGINS: 'https://a.example, https://b.example' });

  assert.deepEqual(list, ['https://a.example', 'https://b.example']);
});

test('unset, it falls back to where this app is actually served from', () => {
  const list = allowedOrigins({});

  assert.ok(list.includes('https://graphy-one.vercel.app'), 'production');
  assert.ok(list.some((o) => typeof o === 'string' && o.startsWith('http://localhost')), 'local development');
});

test('the production site and a local dev server are allowed', () => {
  const list = allowedOrigins({});

  assert.ok(isOriginAllowed('https://graphy-one.vercel.app', list));
  assert.ok(isOriginAllowed('http://localhost:3002', list));
});

test("a preview of this project's own frontend is allowed — its URL changes every deploy", () => {
  const list = allowedOrigins({});

  assert.ok(isOriginAllowed('https://graphy-k665qoc20-bbongagus-projects.vercel.app', list));
  assert.ok(isOriginAllowed('https://graphy-atn8ko6qt-bbongagus-projects.vercel.app', list));
});

test('somebody else\'s site is not, even on the same host', () => {
  const list = allowedOrigins({});

  assert.equal(isOriginAllowed('https://evil.example', list), false);
  assert.equal(isOriginAllowed('https://someone-else-bbongagus-projects.vercel.app', list), false);
  assert.equal(isOriginAllowed('https://graphy-one.vercel.app.evil.example', list), false);
});

test('a request with no Origin is allowed — curl, a health check, a server', () => {
  assert.ok(isOriginAllowed(undefined, allowedOrigins({})));
});

test('an explicit list is exact: no preview pattern comes with it', () => {
  const list = allowedOrigins({ CORS_ORIGINS: 'https://graphy-one.vercel.app' });

  assert.ok(isOriginAllowed('https://graphy-one.vercel.app', list));
  assert.equal(isOriginAllowed('https://graphy-abc123-bbongagus-projects.vercel.app', list), false);
});

test("a branch preview is allowed too — its hostname has hyphens in the middle", () => {
  const list = allowedOrigins({});

  assert.ok(isOriginAllowed('https://graphy-git-feat-ai-quota-bbongagus-projects.vercel.app', list));
  // Still only this team's projects named graphy.
  assert.equal(isOriginAllowed('https://other-git-main-bbongagus-projects.vercel.app', list), false);
  assert.equal(isOriginAllowed('https://graphy-git-main-someone-else.vercel.app', list), false);
});
