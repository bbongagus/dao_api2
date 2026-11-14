/**
 * A fork is a task whose arrows are alternatives: the person takes one, and
 * what the others lead to is not theirs to do. Pure: who the forks are and
 * where a node's arrows lead in, what is out of the plan out.
 *
 * - `folded`: reached only through the options not taken. Out of the count
 *   and out of view; a tick made there is kept, and is back with a change of
 *   mind.
 * - `pending`: every branch of a fork nobody has chosen at yet — the options
 *   themselves. Not counted either: which of them is the work is not known.
 *
 * Where the branches meet again is neither: that part is everyone's.
 *
 * The rule is the editor's, ported line for line from
 * graphy/stores/services/forks.js with its tests — the agent must agree with
 * the screen on what is out of the plan. Change both together.
 */

export const isFork = (node) => node?.fork === true;

/** The option taken: one of the fork's own arrows, or null. */
export const choiceOf = (fork) => (fork.targets.includes(fork.choice) ? fork.choice : null);

/** A node and everything its arrows lead to. */
export function reach(start, next) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const to of next(id) || []) stack.push(to);
  }
  return seen;
}

/**
 * @param {Array<{ id: string, choice: string|null, targets: string[] }>} forks
 *   each fork, the node its chosen arrow leads to, and where its arrows lead
 * @param {(id: string) => string[]} next - where a node's arrows lead
 * @returns {{ folded: Set<string>, pending: Set<string> }}
 */
export function forkSets(forks, next) {
  const folded = new Set();
  const pending = new Set();
  const reached = new Map(forks.map((f) => [f.id, reach(f.id, next)]));
  // The outer fork first: a fork inside a branch it folds has no say.
  const inside = (fork) => forks.filter((o) => o.id !== fork.id && reached.get(o.id).has(fork.id)).length;
  const outerFirst = [...forks].sort((a, b) => inside(a) - inside(b));

  for (const fork of outerFirst) {
    if (folded.has(fork.id) || pending.has(fork.id)) continue;
    const branches = fork.targets.map((target) => reach(target, next));
    const taken = choiceOf(fork);
    if (taken) {
      const kept = branches[fork.targets.indexOf(taken)];
      for (const branch of branches) {
        for (const id of branch) if (!kept.has(id) && id !== fork.id) folded.add(id);
      }
    } else if (branches.length > 1) {
      const shared = (id) => branches.every((branch) => branch.has(id));
      for (const branch of branches) {
        for (const id of branch) if (!shared(id) && id !== fork.id) pending.add(id);
      }
    }
  }
  return { folded, pending };
}

/**
 * The same, for a stored graph. The arrows come from the link index
 * (links.js): on the server `linkedNodeIds` is almost always empty and the
 * edges are the authority.
 * @param {Array} nodes - the graph's nodes, nested through `children`
 * @param {{ downstreamOf: (id: string) => string[] }} links - buildLinkIndex(nodes, edges)
 */
export function forkSetsOf(nodes, links) {
  const forks = [];
  const walk = (list) => {
    for (const node of list || []) {
      if (isFork(node)) {
        forks.push({ id: node.id, choice: node.choice ?? null, targets: links.downstreamOf(node.id) });
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return forkSets(forks, links.downstreamOf);
}

export default forkSets;
