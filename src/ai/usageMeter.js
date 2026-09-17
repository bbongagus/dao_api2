/**
 * Adds up what one user turn spent.
 *
 * A turn is not one API call: reading a link can take four, and the agent loop
 * up to twelve. Every one of them is billed, so every one of them is added
 * here — including the ones a turn made before it failed.
 */

import { costOf, UnknownModelError } from './cost.js';

const field = (usage, name) => Number(usage?.[name]) || 0;

export function createUsageMeter() {
  const total = {
    calls: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    dollars: 0,
    /** Calls whose model has no price. They are counted, never billed as free. */
    unpriced: 0,
  };

  /**
   * @param {string} model
   * @param {object} [usage] the `usage` object from a response; a call the API
   *        answered without one still counts as a call.
   */
  function add(model, usage) {
    total.calls += 1;
    total.input += field(usage, 'input_tokens');
    total.output += field(usage, 'output_tokens');
    total.cacheRead += field(usage, 'cache_read_input_tokens');
    total.cacheWrite += field(usage, 'cache_creation_input_tokens');

    try {
      total.dollars += costOf(model, usage ?? {});
    } catch (error) {
      // An unpriced model must not throw away what the rest of the turn cost —
      // the quota still has to be charged for the calls that were priced.
      if (!(error instanceof UnknownModelError)) throw error;
      total.unpriced += 1;
    }
  }

  return { add, total: () => ({ ...total }) };
}

export default createUsageMeter;
