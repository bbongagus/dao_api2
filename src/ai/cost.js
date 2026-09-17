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
 * Dollars per million tokens, as published on 2026-09-17. Cache rates follow
 * Anthropic's multipliers unless a model states its own: writing a token to the
 * cache costs a quarter more than sending it fresh, reading one costs a tenth.
 */
export const PRICES = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

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
  const price = PRICES[model];
  if (!price) throw new UnknownModelError(model);

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
