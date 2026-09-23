/**
 * Which model the agent talks to, and through whom.
 *
 * Everything goes through the Anthropic SDK and the Messages format: Anthropic
 * itself, or any host that speaks the format (OpenRouter, DeepInfra, Fireworks,
 * DeepSeek…). The SDK's own variables choose it:
 *
 *   ANTHROPIC_BASE_URL    where to send; unset is Anthropic
 *   ANTHROPIC_API_KEY     sent as x-api-key (Anthropic)
 *   ANTHROPIC_AUTH_TOKEN  sent as a bearer token (the other hosts); when set,
 *                         the API key is not sent at all
 *   ANTHROPIC_MODEL       the model id that host knows; it must be priced in
 *                         cost.js, or every turn is refused
 *
 * Through OpenRouter a model is served by several hosts, some of them in
 * China, and each call is routed by the `provider` object sent with it:
 *
 *   OPENROUTER_PROVIDERS  comma-separated host slugs to allow, e.g.
 *                         "deepinfra,fireworks,together"; unset allows any
 *   OPENROUTER_ZDR        "true" to allow only hosts that keep no prompts
 *
 * Hosts that keep or train on prompts are always excluded there, and a call
 * may cost no more than the price the quota is charged at.
 *
 *   AI_PROVIDER_NAME      who the person is told their goals are sent to;
 *                         by default derived from the address
 *
 *   AI_THINKING_BUDGET    tokens the model may think before answering, in
 *                         the agent loop only; unset leaves the model to its
 *                         own default (Sonnet: none; GLM on some hosts: a lot)
 */

import { PRICES, isPriced } from './cost.js';

const DEFAULT_MODEL = 'claude-sonnet-5';

// The API's own minimum, and room left under the agent loop's max_tokens
// (16000) for the answer and its tool calls.
const MIN_THINKING = 1024;
const MAX_THINKING = 12000;

function thinkingFrom(value) {
  const budget = Number(value);
  if (!value || !Number.isInteger(budget) || budget < MIN_THINKING || budget > MAX_THINKING) return null;
  return { type: 'enabled', budget_tokens: budget };
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const list = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean);

export function resolveProvider(env = process.env) {
  const baseURL = env.ANTHROPIC_BASE_URL || undefined;
  const authToken = env.ANTHROPIC_AUTH_TOKEN || null;
  const apiKey = authToken ? null : env.ANTHROPIC_API_KEY || null;
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const host = baseURL ? hostOf(baseURL) : 'api.anthropic.com';
  const viaOpenRouter = host === 'openrouter.ai';
  const hosts = list(env.OPENROUTER_PROVIDERS);

  let extraBody = {};
  if (viaOpenRouter) {
    const routing = { data_collection: 'deny' };
    if (hosts.length) routing.only = hosts;
    if (env.OPENROUTER_ZDR === 'true') routing.zdr = true;
    if (isPriced(model)) routing.max_price = { prompt: PRICES[model].input, completion: PRICES[model].output };
    extraBody = { provider: routing };
  }

  const derivedName = viaOpenRouter
    ? `OpenRouter${hosts.length ? ` (${hosts.join(', ')})` : ''}`
    : host === 'api.anthropic.com' ? 'Anthropic' : host;

  return {
    model,
    name: env.AI_PROVIDER_NAME || derivedName,
    configured: Boolean(apiKey || authToken),
    clientOptions: { apiKey, authToken, baseURL },
    extraBody,
    thinking: thinkingFrom(env.AI_THINKING_BUDGET),
  };
}

export default resolveProvider;
