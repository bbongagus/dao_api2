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

import { KIND_TO_TYPES, KIND_LIST } from './graphReadTools.js';
import { buildLinkIndex } from './links.js';
import { compilePlan } from './planCompiler.js';

export { KIND_TO_TYPES, KIND_LIST };

export function createWriteTools(nodes, aliases, edges = []) {
  const staged = [];
  const minted = new Map(); // alias the model invented → its staged add
  const pendingDeletes = new Set(); // ids of nodes staged for deletion
  let planStaged = false; // whether plan() has already succeeded this turn

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

      update({ target, title, description, kind, requiredCompletions }) {
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

        if (Number.isFinite(requiredCompletions) && requiredCompletions > 0) {
          operation.requiredCompletions = requiredCompletions;
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
        // has read tells it what that costs. Check both existing children and
        // any children staged to be added in this same turn.
        if (found.node?.children?.length > 0) {
          return `I will not delete "${found.node.title}" — it has ${found.node.children.length} node(s) inside, and they would go with it. Remove or move those first, or change it instead.`;
        }

        const stagedChildren = staged.filter(op => op.op === 'add' && op.parent === found.id);
        if (stagedChildren.length > 0) {
          const nodeName = found.node ? `"${found.node.title}"` : target;
          const childNames = stagedChildren.map(op => `${op.alias}`).join(', ');
          return `I will not delete ${nodeName} — it has ${stagedChildren.length} node(s) staged inside in this turn (${childNames}), and they would go with it. Remove or move those first, or change it instead.`;
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

      plan(input) {
        // One plan per turn: a second would mint the same plan: aliases, and
        // two plans at once is not something a person can review. This is a
        // dedicated flag rather than "does minted hold a plan: alias" — the
        // latter also matches an ordinary add() that happened to reuse the
        // plan: prefix, which is the alias-collision case below, not this one.
        if (planStaged) {
          return 'A plan is already staged in this turn. Adjust it with the other tools, or ask for a new plan next turn.';
        }

        const section = typeof input?.section === 'string' ? input.section.trim() : '';
        if (section) {
          const found = resolve(section);
          if (found?.error) return found.error;
        }

        const compiled = compilePlan(input, { nodes, aliases });
        if (compiled.error) return compiled.error;

        // compilePlan only knows the plan's own aliases are internally
        // distinct — it cannot see what else this turn already minted. A
        // node added earlier under the same alias (e.g. add({ alias:
        // 'plan:visa' }) ahead of a stage id 'visa') would otherwise be
        // silently overwritten in `minted` instead of refused, the way
        // add() itself refuses a repeat alias.
        for (const operation of compiled.operations) {
          if (operation.op === 'add' && (minted.has(operation.alias) || aliases.nodeAt(operation.alias))) {
            return `The alias ${operation.alias} is already taken in this turn. Rename the node you added, or give the stage another id.`;
          }
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
        return `Staged: a plan of ${compiled.stats.stages} stage(s), ${compiled.stats.nodes} node(s) and ${compiled.stats.links} arrow(s).${now}`;
      },
    },
  };
}

export default createWriteTools;
