/**
 * One queue per graph.
 *
 * Operations do read-modify-write on the whole graph, so two running at once
 * both read the same version and the last save wins. Chaining them onto a
 * promise per graph makes that impossible.
 *
 * Its own module so a shutdown can wait for it: `drain()` is what keeps a
 * SIGTERM from cutting a save in half.
 */

export function createGraphQueue() {
  /** key -> the tail of that graph's chain. Never rejects: see below. */
  const tails = new Map();

  /**
   * @param {string} key normally `${userId}:${graphId}`.
   * @param {() => Promise<any>} run
   * @returns {Promise<any>} the operation's own result — or its own rejection.
   */
  function enqueue(key, run) {
    const previous = tails.get(key) || Promise.resolve();
    const task = previous.then(run);

    // The tail swallows failures so one broken operation cannot wedge every
    // operation queued behind it; the caller still gets the real rejection.
    tails.set(key, task.catch(() => {}));
    return task;
  }

  /**
   * Wait for everything already queued. Nothing new should be arriving by the
   * time this is called — the server has stopped accepting — so a snapshot of
   * the tails is the whole of the work.
   *
   * @returns {Promise<{ pending: number, timedOut: boolean }>}
   */
  async function drain({ timeoutMs = 5000 } = {}) {
    const pending = [...tails.values()];
    if (pending.length === 0) return { pending: 0, timedOut: false };

    let timer;
    const expired = new Promise((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
      // Never hold the process open just to watch a clock.
      timer.unref?.();
    });

    const timedOut = await Promise.race([Promise.allSettled(pending).then(() => false), expired]);
    clearTimeout(timer);
    return { pending: pending.length, timedOut };
  }

  return { enqueue, drain, get size() { return tails.size; } };
}

export default createGraphQueue;
