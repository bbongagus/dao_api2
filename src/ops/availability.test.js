import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAvailability } from './availability.js';
const config = { healthUrl: 'https://api.example.test/health', siteUrl: 'https://app.example.test/' };
test('monitor checks Redis readiness and the app document, not just an HTTP 200', async () => {
  const fetcher = async (url) => ({ ok: true, json: async () => ({ status: 'healthy', redis: true }), text: async () => '<div id="root"></div>' });
  assert.deepEqual(await checkAvailability({ ...config, fetcher }), { api: true, site: true });
  assert.deepEqual(await checkAvailability({ ...config, fetcher: async () => ({ ok: true, json: async () => ({ status: 'healthy', redis: false }), text: async () => 'maintenance' }) }), { api: false, site: false });
});
test('monitor contains network failures and refuses credentials in configuration', async () => {
  assert.deepEqual(await checkAvailability({ ...config, fetcher: async () => { throw new Error('offline'); } }), { api: false, site: false });
  await assert.rejects(() => checkAvailability({ ...config, healthUrl: 'https://user:secret@example.test/' }));
});
