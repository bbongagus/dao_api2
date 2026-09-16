import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maskUserId, countNodes, censusLine } from './census.js';

test('provider ids are masked the same way every time; our own ids are shown', () => {
  assert.match(maskUserId('google-oauth2|10987654321'), /^google-oauth2\|~[0-9a-f]{6}$/);
  assert.equal(maskUserId('google-oauth2|10987654321'), maskUserId('google-oauth2|10987654321'));
  assert.notEqual(maskUserId('auth0|a'), maskUserId('auth0|b'));
  assert.equal(maskUserId('dev-user-1'), 'dev-user-1');
  assert.equal(maskUserId('1'), '1');
});

test('nodes are counted through every level of children', () => {
  assert.equal(countNodes([{ id: 'a', children: [{ id: 'b', children: [{ id: 'c' }] }] }, { id: 'd' }]), 4);
  assert.equal(countNodes(undefined), 0);
});

test('a census line counts nodes and edges and fingerprints exactly what is stored', () => {
  const raw = JSON.stringify({ nodes: [{ id: 'a', children: [{ id: 'b' }] }, { id: 'd' }], edges: [{ id: 'e1' }] });

  const line = censusLine({ userId: 'dev-user-1', graphId: 'main', raw });

  assert.match(line, /^dev-user-1 main nodes=3 edges=1 sha=[0-9a-f]{12}$/);
  assert.equal(line, censusLine({ userId: 'dev-user-1', graphId: 'main', raw }));
  assert.notEqual(line, censusLine({ userId: 'dev-user-1', graphId: 'main', raw: raw.replace('"d"', '"x"') }));
});

test('a graph that is not JSON is reported, not thrown', () => {
  assert.match(censusLine({ userId: '1', graphId: 'main', raw: '{broken' }), /^1 main unparseable sha=[0-9a-f]{12}$/);
});
