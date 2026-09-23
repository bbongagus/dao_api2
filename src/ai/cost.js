/**
 * What a turn cost, in dollars.
 *
 * Every number the quota works from starts here, so an unpriced model throws
 * rather than billing nothing: a model swapped in through an environment
 * variable must not quietly become free.
 */

/** A model nobody has priced. Billing it as zero would hand out unlimited spend. */
export class UnknownModelError extends Error {
  constructor(model) {
    super(`no price for model "${model}"`);
    this.name = 'UnknownModelError';
  }
}

/**
 * Dollars per million tokens. Cache rates follow Anthropic's multipliers
 * unless a model states its own: writing a token to the cache costs a quarter
 * more than sending it fresh, reading one costs a tenth.
 *
 * Anthropic's models by their own ids, as published on 2026-09-17.
 *
 * The rest by their OpenRouter slugs, read from openrouter.ai on 2026-09-23.
 * A model there is served by several hosts at different prices, so each is
 * priced at the dearest of the US hosts it may be routed to (DeepInfra,
 * Fireworks, Together) — and provider.js sends that same price as OpenRouter's
 * `max_price`, so a call is never billed above what the quota is charged.
 * None of them charges extra for writing the cache, so each states its rates.
 */
export const PRICES = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },

  'anthropic/claude-sonnet-5': { input: 2, output: 10 },
  'z-ai/glm-5.3-flash': { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0.15 },
  'deepseek/deepseek-v4.1-flash': { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.3 },
  // Only Alibaba serves it, from outside the US.
  'qwen/qwen3.8-flash': { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 },
  'google/gemini-3.8-flash': { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.75 },

  // DeepInfra directly, by its own id, read from its model list on 2026-09-23.
  'zai-org/GLM-5.3-Flash': { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0.15 },
};

/** Whether a turn on this model can be charged. A turn that cannot is refused. */
export function isPriced(model) {
  return Object.hasOwn(PRICES, model);
}

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;
const MILLION = 1_000_000;

/**
 * @param {string} model
 * @param {{ input_tokens?: number, output_tokens?: number,
 *           cache_creation_input_tokens?: number, cache_read_input_tokens?: number }} usage
 *        The `usage` object as the Anthropic API returns it. A field the API
 *        left out is zero, never NaN — a NaN would poison the running total.
 * @returns {number} dollars
 */
export function costOf(model, usage = {}) {
  if (!isPriced(model)) throw new UnknownModelError(model);
  const price = PRICES[model];

  const cacheWrite = price.cacheWrite ?? price.input * CACHE_WRITE_MULTIPLIER;
  const cacheRead = price.cacheRead ?? price.input * CACHE_READ_MULTIPLIER;

  const tokens = (field) => Number(usage[field]) || 0;

  return (
    (tokens('input_tokens') * price.input +
      tokens('output_tokens') * price.output +
      tokens('cache_creation_input_tokens') * cacheWrite +
      tokens('cache_read_input_tokens') * cacheRead) /
    MILLION
  );
}
