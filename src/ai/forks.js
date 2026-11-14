/**
 * A fork is a task whose arrows are alternatives: the person takes one, and
 * what the others lead to is not theirs to do. Pure: a level and where its
 * arrows lead in; who the forks are and what is out of the plan out.
 *
 * - `folded`: reached only through the options not taken. Out of the count
 *   and out of view; a tick made there is kept, and is back with a change of
 *   mind.
 * - `pending`: every branch of a fork nobody has chosen at yet — the options
 *   themselves. Not counted either: which of them is the work is not known.
 *
 * Where the branches meet again is neither: that part is everyone's.
 *
 * A fork is decided when the option on it is one of its arrows. Its tick
 * (`isDone`) is set with the choice but is not what says so: the two can
 * part — the step chosen deleted, a reset, a tick older than the second
 * arrow — and every reader goes by the choice.
 *
 * The rule is the editor's: everything from here down to `forkSets` is
 * graphy/stores/services/forks.js line for line (as of its commit e1720d4),
 * with its tests, because the agent has to agree with the screen on what a
 * fork is and what it leaves out. Change both together. `readForks` is the
 * server's own: it applies the rule to a stored graph, level by level, as
 * the editor's ProgressCalculator does.
 */

const marked = (node) => node?.fork === true;
const plainTask = (node) => node.nodeType === 'dao' && (node.children?.length ?? 0) === 0;

/**
 * A node's fork fields as the model can hold them. The server keeps whatever
 * an update carries, so these can arrive as anything; what cannot be read is
 * taken for "no fork, no choice, no names", never for a reason not to load.
 * @returns {{ fork: boolean, choice: string|null, forkOptions: Array<{ target, label, hint }> }}
 */
export const cleanFork = ({ fork, choice, forkOptions } = {}) => ({
  fork: fork === true,
  choice: typeof choice === 'string' ? choice : null,
  forkOptions: (Array.isArray(forkOptions) ? forkOptions : [])
    .filter((option) => option && typeof option.target === 'string')
    .map((option) => ({
      target: option.target,
      label: typeof option.label === 'string' ? option.label : '',
      hint: typeof option.hint === 'string' ? option.hint : '',
    })),
});

/** Whether a level may hold a fork at all: asked before its arrows are read. */
export const mayFork = (level) => level.some(marked);

/**
 * The forks of one level. Marking a node `fork` is asking for one; it is one
 * when it is a task with nothing inside and at least two arrows leave it for
 * nodes of its own level — those are its options. With one way on, or none,
 * there is nothing to choose between, and with a level inside it is a folder:
 * such a node is the task or folder it otherwise is, ticked like any other.
 *
 * @param {Array} level - the nodes of one level
 * @param {(id: string) => string[]} next - where a node's arrows lead on this level
 * @returns {Array<{ id: string, targets: string[], choice: string|null }>}
 *   `choice` is the option taken — one of `targets` — or null
 */
export function forksOf(level, next) {
  const forks = [];
  for (const node of level) {
    if (!marked(node) || !plainTask(node)) continue;
    const targets = [...new Set(next(node.id) || [])];
    if (targets.length < 2) continue;
    forks.push({ id: node.id, targets, choice: targets.includes(node.choice) ? node.choice : null });
  }
  return forks;
}

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
 * The forks of a stored graph, level by level, as the screen reads them. An
 * arrow counts on the level whose two nodes it joins, and the arrows come
 * from the link index (links.js): on the server `linkedNodeIds` is almost
 * always empty and the edges are the authority.
 *
 * @param {Array} nodes - the graph's nodes, nested through `children`
 * @param {{ downstreamOf: (id: string) => string[] }} links - buildLinkIndex(nodes, edges)
 * @returns {{ forkOf: Map<string, { id: string, targets: string[], choice: string|null }>,
 *   folded: Set<string>, pending: Set<string> }} every fork by its id, and
 *   what the forks leave out of the plan
 */
export function readForks(nodes, links) {
  const forkOf = new Map();
  const folded = new Set();
  const pending = new Set();

  const walk = (level) => {
    if (!level?.length) return;
    if (mayFork(level)) {
      const here = new Set(level.map((node) => node.id));
      const next = (id) => links.downstreamOf(id).filter((to) => here.has(to));
      const forks = forksOf(level, next);
      const sets = forkSets(forks, next);
      for (const fork of forks) forkOf.set(fork.id, fork);
      for (const id of sets.folded) folded.add(id);
      for (const id of sets.pending) pending.add(id);
    }
    for (const node of level) walk(node.children);
  };
  walk(nodes);

  return { forkOf, folded, pending };
}

export default forkSets;
