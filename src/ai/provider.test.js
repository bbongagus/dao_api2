import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveProvider } from './provider.js';

test('with nothing set, the agent talks to Anthropic on Sonnet 5 and sends nothing extra', () => {
  const provider = resolveProvider({ ANTHROPIC_API_KEY: 'sk-ant-x' });

  assert.equal(provider.model, 'claude-sonnet-5');
  assert.equal(provider.name, 'Anthropic');
  assert.deepEqual(provider.extraBody, {});
  assert.equal(provider.configured, true);
  assert.deepEqual(provider.clientOptions, { apiKey: 'sk-ant-x', authToken: null, baseURL: undefined });
});

test('no key at all is not configured', () => {
  assert.equal(resolveProvider({}).configured, false);
});

test('through OpenRouter: bearer token only, US hosts pinned, no data kept, never dearer than the quota charges', () => {
  const provider = resolveProvider({
    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    ANTHROPIC_AUTH_TOKEN: 'sk-or-x',
    ANTHROPIC_API_KEY: 'sk-ant-left-over',
    ANTHROPIC_MODEL: 'z-ai/glm-5.3-flash',
    OPENROUTER_PROVIDERS: 'deepinfra, fireworks,together',
  });

  assert.equal(provider.model, 'z-ai/glm-5.3-flash');
  assert.equal(provider.name, 'OpenRouter (deepinfra, fireworks, together)');
  // An x-api-key beside the bearer token is a second credential OpenRouter
  // is not meant to see.
  assert.deepEqual(provider.clientOptions, { apiKey: null, authToken: 'sk-or-x', baseURL: 'https://openrouter.ai/api' });
  assert.deepEqual(provider.extraBody, {
    provider: {
      only: ['deepinfra', 'fireworks', 'together'],
      data_collection: 'deny',
      // The price cost.js charges the quota at is the most a call may cost.
      max_price: { prompt: 0.15, completion: 0.5 },
    },
  });
});

test('zero data retention can be required on top', () => {
  const provider = resolveProvider({
    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    ANTHROPIC_AUTH_TOKEN: 'k',
    ANTHROPIC_MODEL: 'deepseek/deepseek-v4.1-flash',
    OPENROUTER_ZDR: 'true',
  });

  assert.equal(provider.extraBody.provider.zdr, true);
  assert.equal(provider.extraBody.provider.only, undefined, 'no list means any host that meets the rest');
});

test('another host is named by its address unless a name is given', () => {
  assert.equal(resolveProvider({ ANTHROPIC_BASE_URL: 'https://api.deepinfra.com/anthropic' }).name, 'api.deepinfra.com');
  assert.equal(resolveProvider({ ANTHROPIC_BASE_URL: 'https://api.deepinfra.com/anthropic', AI_PROVIDER_NAME: 'DeepInfra (US)' }).name, 'DeepInfra (US)');
  assert.deepEqual(resolveProvider({ ANTHROPIC_BASE_URL: 'https://api.deepinfra.com/anthropic' }).extraBody, {});
});

test('a thinking budget turns thinking on for the agent loop, and only a sane one is sent', () => {
  const base = { ANTHROPIC_BASE_URL: 'https://api.deepinfra.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'k' };

  assert.deepEqual(resolveProvider({ ...base, AI_THINKING_BUDGET: '2048' }).thinking, { type: 'enabled', budget_tokens: 2048 });
  assert.equal(resolveProvider(base).thinking, null, 'unset leaves the model to its default');
  // Below the API's minimum, above what the loop's max_tokens leaves room
  // for, or not a number at all: not sent, rather than a turn that fails.
  for (const bad of ['512', '20000', 'lots', '2048.5']) {
    assert.equal(resolveProvider({ ...base, AI_THINKING_BUDGET: bad }).thinking, null, bad);
  }
});
