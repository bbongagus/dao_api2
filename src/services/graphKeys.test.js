import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseGraphKey, scanGraphKeys } from './graphKeys.js';

test('a graph key names its user and its graph', () => {
  assert.deepEqual(
    parseGraphKey('user:google-oauth2|10987654321:graph:main'),
    { userId: 'google-oauth2|10987654321', graphId: 'main' },
  );
});

test('keys that are not a stored graph are not parsed', () => {
  for (const key of ['graph:main', 'history:u:main:1789', 'user:u:graph:main:extra', 'journal:u:main', 'user::graph:main']) {
    assert.equal(parseGraphKey(key), null, key);
  }
});

test('a scan walks every cursor page and yields each graph once', async () => {
  const pages = {
    '0': ['7', ['user:a:graph:main', 'user:a:graph:main:extra']],
    '7': ['9', ['user:b:graph:main', 'user:a:graph:main']],
    '9': ['0', ['user:c:graph:side']],
  };
  const calls = [];
  const redis = {
    scan: async (cursor, ...args) => {
      calls.push([cursor, ...args]);
      return pages[cursor];
    },
  };

  const found = [];
  for await (const graph of scanGraphKeys(redis)) found.push(graph);

  assert.deepEqual(found, [
    { key: 'user:a:graph:main', userId: 'a', graphId: 'main' },
    { key: 'user:b:graph:main', userId: 'b', graphId: 'main' },
    { key: 'user:c:graph:side', userId: 'c', graphId: 'side' },
  ]);
  assert.deepEqual(calls[0], ['0', 'MATCH', 'user:*:graph:*', 'COUNT', 200]);
  assert.equal(calls.length, 3);
});
