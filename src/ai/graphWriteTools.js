/**
 * What the agent can change — or rather, propose changing.
 *
 * None of these touch the graph. They validate against it and append to a
 * staged set that the user sees and confirms. That is the whole safety model:
 * reading is free, writing is a proposal.
 *
 * Refusals come back as sentences the model can act on, not exceptions. A
 * refused delete should make it suggest something else, not end the turn.
 */

import { KIND_TO_TYPES, KIND_LIST, kindNameOf } from './graphReadTools.js';
import { buildLinkIndex } from './links.js';
import { compilePlan } from './planCompiler.js';

export { KIND_TO_TYPES, KIND_LIST };

/** The node holding `id`, or null when it sits at the top level or nowhere. */
function parentOf(list, id, parent = null) {
  for (const node of list) {
    if (node.id === id) return parent;
    const found = parentOf(node.children || [], id, node);
    if (found !== undefined) return found;
  }
  return undefined;
}

const contains = (node, id) => (node.children || []).some((child) => child.id === id || contains(child, id));

/**
 * @param {{ canMove?: boolean }} [options] - canMove: false when the person's
 *   app predates the move operation. It would skip a move and still apply a
 *   delete staged after it, taking the moved nodes with the deleted parent.
 */
export function createWriteTools(nodes, aliases, edges = [], { canMove = true } = {}) {
  const staged = [];
  const minted = new Map(); // alias the model invented → its staged add
  const pendingDeletes = new Set(); // ids of nodes staged for deletion
  let planStaged = false; // whether plan() has already succeeded this turn
  const marked = new Set(); // ids of tasks staged to be ticked or unticked
  const moves = new Map(); // id of a node staged to move → its new parent's id, null for the top level

  // Whether two nodes are connected once what is staged so far is applied.
  // A link staged twice, or on top of one that exists, is applied twice.
  const links = buildLinkIndex(nodes, edges);
  const pair = (from, to) => `${from}→${to}`;
  const stagedLinks = new Set();
  const stagedUnlinks = new Set();
  const connected = (from, to) =>
    stagedLinks.has(pair(from, to)) || (links.has(from, to) && !stagedUnlinks.has(pair(from, to)));

  /** A reference is either an existing node, or one staged in this same turn. */
  const resolve = (ref) => {
    const node = aliases.nodeAt(ref);
    if (node) {
      if (pendingDeletes.has(node.id)) {
        return { error: `${ref} is already staged for deletion, and cannot be referenced again. Remove that operation first, or build a different change.` };
      }
      return { id: node.id, node };
    }
    if (minted.has(ref)) {
      if (pendingDeletes.has(ref)) {
        return { error: `${ref} is already staged for deletion, and cannot be referenced again. Remove that operation first, or build a different change.` };
      }
      return { id: ref, node: null };
    }
    return null;
  };

  const number = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

  return {
    staged,
    tools: {
      add({ alias, parent, title, description, kind, x, y }) {
        if (typeof alias !== 'string' || !alias) return 'Give the new node an alias (a string) so other operations can point at it.';
        if (minted.has(alias) || aliases.nodeAt(alias)) {
          return `The alias ${alias} is already taken in this turn. Pick another.`;
        }
        if (typeof title !== 'string' || !title.trim()) return 'A node needs a title (a string).';

        if (typeof kind !== 'string') return 'A kind must be a string.';
        const types = KIND_TO_TYPES[kind];
        if (!types) {
          return `${kind} is not a kind I know. Use one of: ${KIND_LIST.join(', ')}.`;
        }

        let parentId = null;
        if (parent) {
          if (typeof parent !== 'string') return 'A parent must be a string.';
          const found = resolve(parent);
          if (found?.error) return found.error;
          if (!found) return `There is no node called ${parent} to put this inside.`;
          parentId = found.id;
        }

        const operation = {
          op: 'add',
          alias,
          parent: parentId,
          title: title.trim(),
          description: typeof description === 'string' ? description : '',
          ...types,
          x: number(x),
          y: number(y),
          downstream: [],
        };

        staged.push(operation);
        minted.set(alias, operation);

        const where = parentId ? ` inside ${parent}` : ' at the top level';
        return `Staged: add "${operation.title}" (${kind})${where}, as ${alias}.`;
      },

      // No repetition target: only a Kata had one, and the agent no longer
      // makes Kata (2026-09-18).
      update({ target, title, description, kind }) {
        if (typeof target !== 'string') return 'A target must be a string.';
        const found = resolve(target);
        if (found?.error) return found.error;
        if (!found) return `There is no node called ${target}.`;

        const operation = { op: 'update', target: found.id };

        if (typeof title === 'string' && title.trim()) operation.title = title.trim();
        if (typeof description === 'string' && description.trim()) operation.description = description;

        if (kind) {
          if (typeof kind !== 'string') return 'A kind must be a string.';
          const types = KIND_TO_TYPES[kind];
          if (!types) return `${kind} is not a kind I know. Use one of: ${KIND_LIST.join(', ')}.`;
          Object.assign(operation, types);
        }

        if (Object.keys(operation).length <= 2) {
          return 'That update changes nothing. Say which field should change.';
        }

        staged.push(operation);
        const name = found.node ? `"${found.node.title}"` : target;
        return `Staged: update ${name}.`;
      },

      remove({ target }) {
        if (typeof target !== 'string') return 'A target must be a string.';
        const found = resolve(target);
        if (found?.error) return found.error;
        if (!found) return `There is no node called ${target}.`;

        // Deleting a parent takes its subtree with it, and nothing the agent
        // has read tells it what that costs. Check existing children that are
        // not staged to move out, and any children staged to be added or
        // moved in during this same turn.
        const staying = (found.node?.children || []).filter((child) => !moves.has(child.id));
        if (staying.length > 0) {
          return `I will not delete "${found.node.title}" — it has ${staying.length} node(s) inside, and they would go with it. Move those out first, or change it instead.`;
        }

        const stagedChildren = staged.filter(op => (op.op === 'add' || op.op === 'move') && op.parent === found.id);
        if (stagedChildren.length > 0) {
          const nodeName = found.node ? `"${found.node.title}"` : target;
          const childNames = stagedChildren.map(op => op.alias || aliases.aliasOf(op.target)).join(', ');
          return `I will not delete ${nodeName} — ${stagedChildren.length} node(s) are staged to go inside it in this turn (${childNames}), and they would go with it. Put those somewhere else, or change it instead.`;
        }

        // Refuse to delete a node that was added in this same turn.
        // It does not exist yet, so deleting it is meaningless; if it should
        // not be there, do not add it in the first place.
        if (!found.node && minted.has(found.id)) {
          return `${target} does not exist yet — it is being added in this same turn. If you do not want it, remove it from the additions instead.`;
        }

        staged.push({ op: 'delete', target: found.id });
        pendingDeletes.add(found.id);
        const name = found.node ? `"${found.node.title}"` : target;
        return `Staged: delete ${name}.`;
      },

      link({ source, target }) {
        if (typeof source !== 'string') return 'A source must be a string.';
        if (typeof target !== 'string') return 'A target must be a string.';
        const from = resolve(source);
        const to = resolve(target);
        if (from?.error) return from.error;
        if (to?.error) return to.error;
        if (!from) return `There is no node called ${source}.`;
        if (!to) return `There is no node called ${target}.`;
        if (from.id === to.id) return 'A node cannot lead to itself.';

        if (stagedLinks.has(pair(from.id, to.id))) {
          return `${source} → ${target} is already staged in this turn. Nothing to add.`;
        }
        if (connected(from.id, to.id)) {
          return `${source} and ${target} are already connected (${source} → ${target}). Nothing to add.`;
        }

        staged.push({ op: 'link', source: from.id, target: to.id });
        stagedLinks.add(pair(from.id, to.id));
        stagedUnlinks.delete(pair(from.id, to.id));
        return `Staged: ${source} → ${target}.`;
      },

      unlink({ source, target }) {
        if (typeof source !== 'string') return 'A source must be a string.';
        if (typeof target !== 'string') return 'A target must be a string.';
        const from = resolve(source);
        const to = resolve(target);
        if (from?.error) return from.error;
        if (to?.error) return to.error;
        if (!from) return `There is no node called ${source}.`;
        if (!to) return `There is no node called ${target}.`;

        // The editor disconnects a pair whichever way the arrow points.
        if (!connected(from.id, to.id) && !connected(to.id, from.id)) {
          return `${source} and ${target} are not connected, so there is nothing to disconnect.`;
        }

        staged.push({ op: 'unlink', source: from.id, target: to.id });
        for (const key of [pair(from.id, to.id), pair(to.id, from.id)]) {
          stagedUnlinks.add(key);
          stagedLinks.delete(key);
        }
        return `Staged: disconnect ${source} from ${target}.`;
      },

      // The one way to change where a node sits. Deleting it and adding it
      // again elsewhere loses its tick, its arrows and its id.
      move({ target, parent }) {
        if (!canMove) {
          return 'This person\'s app is older than moving and cannot apply a move yet. Do not delete the node and add it again elsewhere instead: its tick and arrows would be lost. Say that a reload of the page lets you move it.';
        }
        if (typeof target !== 'string') return 'A target must be a string.';
        const found = resolve(target);
        if (found?.error) return found.error;
        if (!found) return `There is no node called ${target}.`;
        if (!found.node) return `${target} is being added in this same turn. Give it the right parent in add_node instead.`;
        if (moves.has(found.id)) return `"${found.node.title}" is already staged to move in this turn. Nothing to add.`;

        let parentId = null;
        let where = 'the top level';
        if (parent) {
          if (typeof parent !== 'string') return 'A parent must be a string.';
          const into = resolve(parent);
          if (into?.error) return into.error;
          if (!into) return `There is no node called ${parent} to put it inside.`;
          const kind = into.node || minted.get(into.id);
          if (kind.nodeType !== 'dao' && kindNameOf(kind) !== 'ryu') {
            return `A ${kindNameOf(kind)} holds nothing inside it. Nodes go inside a ryu or a task.`;
          }
          if (into.id === found.id || contains(found.node, into.id)) {
            return `"${found.node.title}" cannot go inside itself.`;
          }
          parentId = into.id;
          where = into.node ? `"${into.node.title}"` : parent;
        }

        const from = parentOf(nodes, found.id) ?? null;
        if ((from?.id ?? null) === parentId) return `"${found.node.title}" is already there. Nothing to change.`;

        staged.push({ op: 'move', target: found.id, parent: parentId });
        moves.set(found.id, parentId);

        const emptied = from?.nodeType === 'dao' && from.children.every((child) => moves.has(child.id))
          ? ` "${from.title}" has nothing left inside and becomes a plain task.`
          : '';
        return `Staged: move "${found.node.title}" into ${where}. It keeps its tick, its arrows and what is inside it.${emptied}`;
      },

      markDone({ target, done }) {
        if (typeof target !== 'string') return 'A target must be a string.';
        if (typeof done !== 'boolean') return 'Say done: true to tick the task, or done: false to take the tick back.';
        const found = resolve(target);
        if (found?.error) return found.error;
        if (!found) return `There is no node called ${target}. Use tasks to find the right one.`;
        if (!found.node) return `${target} is being added in this same turn; it can be ticked once it exists.`;

        const { node } = found;
        if (kindNameOf(node) !== 'dao') {
          return `"${node.title}" is a ${kindNameOf(node)}: its progress comes from the tasks it counts, not from a tick of its own. Mark those tasks instead.`;
        }

        // A checklist card, or a folder, reads its progress from what is
        // inside; a tick of its own would change nothing on it.
        if (node.children?.length) {
          const left = node.children
            .filter((child) => Boolean(child.isDone) !== done)
            .map((child) => `${aliases.aliasOf(child.id)} "${child.title}"`);
          return left.length
            ? `"${node.title}" has ${node.children.length} item(s) inside, and its progress is theirs. Mark the ones the person means: ${left.join(', ')}.`
            : `"${node.title}" has ${node.children.length} item(s) inside, and every one is already ${done ? 'done' : 'not done'}. Nothing to change.`;
        }

        if (marked.has(node.id)) return `"${node.title}" is already staged to be marked in this turn. Nothing to add.`;
        if (Boolean(node.isDone) === done) {
          return `"${node.title}" is already ${done ? 'done' : 'not done'}. Nothing to change.`;
        }

        staged.push({ op: 'done', target: node.id, isDone: done });
        marked.add(node.id);
        return `Staged: mark "${node.title}" ${done ? 'done' : 'not done'}.`;
      },

      plan(input) {
        // One plan per turn: a second would mint the same plan: aliases, and
        // two plans at once is not something a person can review. A second
        // call replaces the first rather than being refused — a model that
        // tried the tool out with a throwaway plan was otherwise stuck with
        // it, and the person was shown the throwaway. It cannot replace a
        // plan that other staged changes already point at: those would be
        // left pointing at nothing. This is a dedicated flag rather than
        // "does minted hold a plan: alias" — the latter also matches an
        // ordinary add() that reused the plan: prefix, which is the
        // alias-collision case below, not this one.
        const earlier = planStaged ? staged.filter((o) => o.plan) : [];
        const earlierAliases = new Set(earlier.filter((o) => o.op === 'add').map((o) => o.alias));
        if (planStaged) {
          const leaning = staged.some((o) => !o.plan && [o.parent, o.source, o.target].some((ref) => earlierAliases.has(ref)));
          if (leaning) {
            return 'A plan is already staged in this turn, and other staged changes point at its nodes. Adjust it with the other tools, or ask for a new plan next turn.';
          }
        }

        // A model shown `"" for a new section` sometimes sends the quotes
        // themselves; a pair of quotes names no node, so it means none.
        const section = typeof input?.section === 'string' ? input.section.trim().replace(/^(["'`])\1$/, '') : '';
        if (section) {
          const found = resolve(section);
          if (found?.error) return found.error;
          if (found && !found.node) {
            return `${section} is being added in this same turn, and a plan cannot go inside a node that does not exist yet. Leave section empty and give a sectionTitle: the plan makes its own section.`;
          }
        }

        const compiled = compilePlan({ ...input, section }, { nodes, aliases });
        if (compiled.error) return compiled.error;

        // compilePlan only knows the plan's own aliases are internally
        // distinct — it cannot see what else this turn already minted. A
        // node added earlier under the same alias (e.g. add({ alias:
        // 'plan:visa' }) ahead of a stage id 'visa') would otherwise be
        // silently overwritten in `minted` instead of refused, the way
        // add() itself refuses a repeat alias.
        for (const operation of compiled.operations) {
          const takenThisTurn = minted.has(operation.alias) && !earlierAliases.has(operation.alias);
          if (operation.op === 'add' && (takenThisTurn || aliases.nodeAt(operation.alias))) {
            return `The alias ${operation.alias} is already taken in this turn. Rename the node you added, or give the stage another id.`;
          }
        }

        // Only now, with the new plan known to be good, does the old one go.
        for (const operation of earlier) {
          staged.splice(staged.indexOf(operation), 1);
          if (operation.op === 'add') minted.delete(operation.alias);
          if (operation.op === 'link') stagedLinks.delete(pair(operation.source, operation.target));
        }

        for (const operation of compiled.operations) {
          staged.push({ ...operation, plan: true });
          if (operation.op === 'add') minted.set(operation.alias, operation);
          if (operation.op === 'link') stagedLinks.add(pair(operation.source, operation.target));
        }
        planStaged = true;

        const now = compiled.startNow.length
          ? ` Can start now: ${compiled.startNow.map((title) => `"${title}"`).join(', ')}.`
          : '';
        const replaced = earlier.length ? ' It replaces the plan staged earlier in this turn.' : '';
        return `Staged: a plan of ${compiled.stats.stages} stage(s), ${compiled.stats.nodes} node(s) and ${compiled.stats.links} arrow(s).${now}${replaced}`;
      },
    },
  };
}

export default createWriteTools;
